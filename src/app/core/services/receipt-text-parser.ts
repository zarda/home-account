/**
 * Last-resort receipt parser, used when neither Apple Intelligence nor a cloud
 * model can structure OCR text, and the second witness to the total Apple
 * Intelligence reads on the device.
 *
 * It reads structure rather than vocabulary — digits, positions, ISO 4217 codes
 * and Unicode currency signs. The keyword tables it used to carry (English
 * total/amount/due, English month names, a four-currency lexicon) meant a
 * receipt in any other language came back as $0.00 dated today while looking to
 * the caller exactly like a successful parse. What it cannot find now shows up
 * in `confidence` instead, so the caller can send the receipt to an engine that
 * can actually read it.
 *
 * Which way the money moved is read the same way: from the marks a receipt
 * prints on its total — a minus, an accounting triangle, accounting
 * parentheses — and never from a word such as "refund" in any language.
 */
import { localDateFromParts } from '../utils/transaction-date.utils';

export interface ParsedReceiptText {
  date: Date;
  /**
   * Never negative, whichever way the money moved (`direction` says which),
   * and 0 when no total was read.
   */
  amount: number;
  currency: string;
  merchant: string;
  /**
   * 0–1: confidence in `amount` on its own, before date and currency are
   * folded into the combined score below. Lower than the tier it was read at
   * when the winning figure was demoted, as `amountDemotion` says, so a caller
   * can flag the receipt for review even where the combined `confidence`
   * still looks fine.
   */
  amountConfidence: number;
  /**
   * Why `amountConfidence` sits under the tier the figure was read in:
   * 'tender' when the largest figure was read as the cash handed over and the
   * total it was change for won instead; 'aside' when the reading passed a
   * figure printed as a labelled aside, (Reg $15.00), or kept one only
   * because nothing else in its tier stood beside it while a weaker tier held
   * a figure printed on its own; 'count' when a whole number printed bare
   * beside money, read as a count, a size or a code, is larger than the
   * figure read and might have been the total (Total 1280 Tax ¥116). Absent
   * when nothing was demoted.
   */
  amountDemotion?: 'tender' | 'aside' | 'count';
  /**
   * Which way the winning total moved, read from typography alone: 'credit'
   * when every copy of that figure carries a negative mark and nothing argues
   * with them, 'debit' otherwise. The copies are the figures of its value the
   * receipt prints as money when the total was read as money, and every
   * figure of its value when it was read from the plain numbers. A count that
   * might have been the total carries no mark, and keeps the reading a debit
   * where it shares a line with a copy (Total 12 Tax -$0.96) or stands where a
   * total does (Coupon -$3.00 over Tax $1.00 Total 12). A mark on any other
   * figure — a discount, a coupon, the change — says nothing about the total.
   */
  direction: 'credit' | 'debit';
  /**
   * 0–1, and always under the bar that sends a field for review, because a
   * mark is typography rather than a word saying so: 0.5 for a credit; 0.3
   * when the same figure is printed both marked and unmarked, or marked where
   * a count might have been the total, where `direction` stays 'debit';
   * 0 when nothing marks it, the purchase every receipt is by default. It is
   * not folded into the combined `confidence`, so it moves no routing
   * decision.
   */
  directionConfidence: number;
  /**
   * 0–1: how clearly the date was read — 0.9 for an unambiguous match, scaled
   * down further for an ambiguous day/month order or a two-digit year, 0 when
   * nothing matched at all (including a match the future-date guard rejected).
   */
  dateConfidence: number;
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

// Anything that is neither a digit, a cased letter, a currency sign nor a line
// break separates date parts, so 2026-01-15, 2026/01/15, 2026年1月15日 and
// 2026년 1월 15일 all read on one pattern. Cased letters are excluded so that
// "3 x 4 of 5" is not a date, a currency sign so that the 1 $10.00 of a priced
// line is not one, and a line break because a date is printed on one line: the
// cents that end one line and the figures that start the next are not a date.
const DATE_SEPARATOR = '[^\\d\\p{Lu}\\p{Ll}\\p{Sc}\\n]{1,3}';
const YEAR_FIRST_DATE = new RegExp(
  `(?:^|\\D)((\\d{4})${DATE_SEPARATOR}(\\d{1,2})${DATE_SEPARATOR}(\\d{1,2}))(?!\\d)`,
  'gu',
);
// What a date may follow: the start of the text, anything but a digit, a
// currency sign or a mark that joins digits into one figure, or such a mark
// with no digit before it (No.15/01/26). So a date never starts inside a
// figure, nor at a figure its sign is glued to: the cents of $145.01 are not
// the day of $145.01 01 01 24, and the 27.01 of $27.01 12/5/24 is no date.
const BEFORE_DATE = `(?:^|[^\\d.,'’\\u00A0\\u202F\\u2009\\p{Sc}]|(?:^|\\D)[.,'’\\u00A0\\u202F\\u2009])`;
const YEAR_LAST_DATE = new RegExp(
  `${BEFORE_DATE}((\\d{1,2})${DATE_SEPARATOR}(\\d{1,2})${DATE_SEPARATOR}(\\d{4}|\\d{2}))(?!\\d)`,
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
// spaces are deliberately left out: "2 12 25" is three numbers, not one. No
// sign either: a minus is read as a mark beside the figure, never as part of
// it, so a refund's total stays a positive candidate instead of being skipped
// as a negative number.
const NUMBER_TOKEN = /\d+(?:[.,'’\u00A0\u202F\u2009]\d+)*/gu;
const GROUPING_MARKS = /['’\u00A0\u202F\u2009]/g;

/** Longer runs of digits are phone numbers, receipt numbers and card fragments. */
const MAX_PLAIN_DIGITS = 6;

// The marks a receipt prints to negate a figure: a minus in each form OCR hands
// it back as (hyphen-minus, minus sign, en dash, small and fullwidth
// hyphen-minus), and the triangles East Asian accounting prints for a negative.
const MINUS = '[\\-\\u2212\\u2013\\uFE63\\uFF0D]';
const TRIANGLE = '[\\u25B2\\u25B3]';
// A currency sign, after up to three capitals (HK$, NT$, US$). Capitals only:
// a CJK or lowercase letter there is a word (税込¥1,280), not part of the sign.
const SIGN = '\\p{Lu}{0,3}\\p{Sc}';
// The two forms of parenthesis a receipt prints, as class bodies without the
// brackets so that one copy serves every pattern built from them.
const OPEN_PARENS = '(\\uFF08';
const CLOSE_PARENS = ')\\uFF09';
// What a minus may follow and still be a mark on the figure: a space, a colon
// or an equals sign (the last two also in their fullwidth forms), a Han or
// Hangul letter, where a label and its figure print as one run (合計-1,280,
// 합계-5,900), or an opening parenthesis ((-12.50)). Only the opening one:
// after a closing one, the area code of TEL (03)-3461 would read its number as
// a credit. Two scripts are named, not a class of letters:
// \p{Lo} would take in kana, and OCR hands the katakana long-vowel mark back
// as a hyphen (コーヒ-480). That is typography, not a word table (ADR 0008),
// and it leaves a minus glued to kana, Thai, Arabic, Hebrew or Devanagari a
// miss.
const MINUS_FOLLOWS =
  `[\\s:\\uFF1A=\\uFF1D\\p{Script=Han}\\p{Script=Hangul}${OPEN_PARENS}]`;
// What must sit right before the figure for it to be negative. A minus counts
// after the start of the line or any of those, so one glued to a reference
// (SKU-1234, 03-3461-8901, a row of dashes) does not; nor does a minus with a
// gap before the price, which is a description's dash (Latte - $4.50). A minus
// straight after the sign ($-12.50, US$-5.00) is the sign-first way of printing
// the same negative. A triangle counts even glued to a label (合計▲1,280),
// because that is how East Asian receipts print it, and a space may follow it,
// since a triangle is never a description's dash; but not straight after a
// digit, where a mark between two runs of digits joins them, as the dashes in
// 03-3461-8901 do. A dash after the figure is the stop a Japanese receipt
// prints against alteration (¥10,000-), so nothing after it is read.
const NEGATIVE_BEFORE = new RegExp(
  `(?:(?:^|${MINUS_FOLLOWS})${MINUS}(?:${SIGN}\\s?)?` +
    `|(?:^|[^\\p{N}])${TRIANGLE}\\s?(?:${SIGN}\\s?)?` +
    `|\\p{Sc}${MINUS})$`,
  'u',
);
const OPENS_BEFORE = new RegExp(`[${OPEN_PARENS}](${SIGN})?$`, 'u');
const CLOSES_AFTER = new RegExp(`^(\\p{Sc})?[${CLOSE_PARENS}]`, 'u');
// The parentheses a figure sits inside: the last opening one before it that
// nothing closes, and the first closing one after it that nothing opens.
const UNCLOSED_OPEN = new RegExp(`[${OPEN_PARENS}][^${OPEN_PARENS}${CLOSE_PARENS}]*$`, 'u');
const UNOPENED_CLOSE = new RegExp(`^[^${OPEN_PARENS}${CLOSE_PARENS}]*[${CLOSE_PARENS}]`, 'u');
const ANY_PARENS = new RegExp(`[${OPEN_PARENS}${CLOSE_PARENS}]`, 'u');
// A sign with the capitals it may carry: the US of US$ is money, not a word.
const SIGNS = new RegExp(SIGN, 'gu');
const ONE_SIGN = new RegExp(`^${SIGN}$`, 'u');
// A letter of any script, read as a class and never for what it says.
const LETTER = /\p{L}/u;
// What may stand between a currency sign and its figure and leave the two
// touching: a minus, a triangle or an opening parenthesis before the figure,
// a closing one after it, and one space either way.
const MARK_BEFORE_FIGURE = new RegExp(`(?:${MINUS}|${TRIANGLE}|[${OPEN_PARENS}])?\\s?$`, 'u');
const MARK_AFTER_FIGURE = new RegExp(`^[${CLOSE_PARENS}]?\\s?`, 'u');
const SIGN_LAST = /\p{Sc}$/u;
const SIGN_FIRST = /^\p{Sc}/u;
const SPACE = /\s/u;
// A word of its own after a figure: the Tax of Total 1280 Tax ¥116, past a
// space, a run of marks or a percent figure, its sign plain or fullwidth
// (Total 9, Tax $1.00; Total 12 ... Tax $0.96; Total 120 8% Tax $9.60; 合計
// 1280 10％ 内税 ¥116), or past the letters of a currency printed after the
// figure (合計 980円 内税 ¥72). A unit glued to the figure with only money
// after it (500ml ¥151, 10m -$10.00) is no word of its own.
const WORD_AFTER = /^(?:\p{L}*\s|[^\s\d\p{L}\p{Sc}])(?:[^\d\p{L}\p{Sc}]|\d+(?:[.,]\d+)?\s?[%％])*\p{L}/u;
// One half of a time: the 14 and the 32 of 14:32.
const CLOCK_BEFORE = /\d:$/u;
const CLOCK_AFTER = /^:\d/u;

/** What a credit mark on the total is worth: typography, never a word. */
const CREDIT_MARK_GRADE = 0.5;
/** The total printed both marked and unmarked, which leaves it a purchase. */
const TWINNED_MARK_GRADE = 0.3;

interface AmountCandidate {
  value: number;
  token: string;
  /**
   * Read in the strongest tier: on a line that prints a currency mark, and
   * neither a count beside the money there nor half of a time.
   */
  besideCurrency: boolean;
  /**
   * On a line that prints a currency mark, counts and the halves of a time
   * included: what makes a figure a copy of a total read as money.
   */
  printedBesideCurrency: boolean;
  /** Printed with a negative mark on this figure itself. */
  credit: boolean;
  /**
   * Inside parentheses that hold a word as well as the figure, (Reg $15.00):
   * a regular price, a balance or a saving beside the total. It prices no
   * line, and is never the total while its tier holds a figure printed on its
   * own.
   */
  aside: boolean;
  /**
   * A whole number printed bare beside money on its line: a count, a size or
   * a code (the 24 of Pack of 24 $5.00).
   */
  count: boolean;
  /**
   * A count printed where a total stands: followed on its line by a word of
   * its own (Total 1280 Tax ¥116, Total 9, Tax $1.00, 合計 980円 内税 ¥72),
   * or printed after the line's money (Tax $1.00 Total 9). A count of what a
   * price buys stands before the price (Pack of 24 $5.00, 緑茶 500ml ¥151).
   */
  mayBeTotal: boolean;
  /** The line it is printed on, counting from the first. */
  row: number;
}

interface AmountReading {
  amount: number;
  confidence: number;
  /** Why `confidence` sits under the tier's, when it does. */
  demotion?: 'tender' | 'aside' | 'count';
  direction: 'credit' | 'debit';
  directionConfidence: number;
}

export function parseReceiptOcrText(text: string): ParsedReceiptText {
  const { date, confidence: dateConfidence, matched } = readDate(text);

  // The date comes out of the text before the amounts are read: 15/01/2026 is
  // three numbers, and 2026 is larger than any total the receipt carries.
  const withoutDate = matched ? text.split(matched).join(' ') : text;
  const lines = withoutDate.split('\n').map(line => line.trim()).filter(line => line.length > 0);

  const { currency, confidence: currencyConfidence, marker } = readCurrency(text);
  const {
    amount,
    confidence: amountConfidence,
    demotion,
    direction,
    directionConfidence,
  } = readAmount(lines, marker);

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
    amountConfidence: Math.round(amountConfidence * 100) / 100,
    ...(demotion ? { amountDemotion: demotion } : {}),
    direction,
    directionConfidence: Math.round(directionConfidence * 100) / 100,
    dateConfidence: Math.round(dateConfidence * 100) / 100,
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

/**
 * Confidence multiplier when the winning figure was demoted: as cash tendered,
 * past a figure printed as a labelled aside, or under a larger count.
 */
export const DEMOTION_FACTOR = 0.75;
/** "x + y ≈ M" tolerance: half a cent absorbs float noise, integers must match exactly. */
const TENDER_SUM_TOLERANCE = 0.005;

/** Round the way handed-over cash is: a whole amount divisible by 5. */
function isTenderShaped(value: number): boolean {
  return Number.isInteger(value) && value % 5 === 0;
}

/**
 * The candidate the tier's pick was change FOR, when the pick looks like cash
 * tendered: M is tender-shaped and two other figures satisfy x + y ≈ M with
 * x ≥ y — the printed total plus the change line. They are the tier's other
 * figures, labelled asides included (the tier's pick is its largest figure
 * that is not one), and a whole number printed bare and read as a count, as
 * either figure, where it stands on the pick's own line (合計 538 ¥1,000
 * ¥462) or where a total stands (Total 12 Tax $0.96, or Tax $0.96 Total 12,
 * over Cash $20.00 and Change $8.00; Cash $20.00 Change 8). A count of what a
 * price buys, on another line, stays out (Item 3 $2.00 over Total $5.00).
 * Among matching pairs the largest x wins; if that x is itself tender-shaped
 * ({450, 50, 500} — a taxed total is indistinguishable from a tendered note)
 * the demotion stands down and the pick holds. Vocabulary-free on purpose:
 * this reads arithmetic, not words.
 */
function tenderedDemotion(
  pick: AmountCandidate,
  tier: AmountCandidate[],
  counts: AmountCandidate[],
): AmountCandidate | undefined {
  if (!isTenderShaped(pick.value)) return undefined;
  const rest = tier.filter(c => c !== pick);
  const pairable = [...rest, ...counts.filter(c => c.row === pick.row || c.mayBeTotal)];
  let bestX: AmountCandidate | undefined;
  for (const x of pairable) {
    for (const y of pairable) {
      if (x === y || y.value > x.value) continue;
      if (Math.abs(x.value + y.value - pick.value) > TENDER_SUM_TOLERANCE) continue;
      if (!bestX || x.value > bestX.value) bestX = x;
    }
  }
  return bestX && !isTenderShaped(bestX.value) ? bestX : undefined;
}

function readAmount(lines: string[], marker: string): AmountReading {
  const candidates: AmountCandidate[] = [];
  // The parenthesis the line before left open, for a figure Vision handed
  // back on a line of its own: (Reg / $15.00).
  let opening = '';
  for (const [row, line] of lines.entries()) {
    const printed = CURRENCY_SIGN.test(line) || (marker !== '' && line.includes(marker));
    const figures: { candidate: AmountCandidate; start: number; end: number }[] = [];
    for (const match of line.matchAll(NUMBER_TOKEN)) {
      const value = toAmount(match[0]);
      // A zero is never a candidate, which also keeps a "-0.00" change line
      // from ever reading as a credit.
      if (value === undefined || value <= 0) {
        continue;
      }
      const token = match[0];
      const before = line.slice(0, match.index);
      const after = line.slice(match.index + token.length);
      const credit = isCreditMarked(before, token, after);
      // A figure printed negative is never an aside, whatever else its
      // parentheses hold: (Refund -$64.79) is a refund's total.
      const aside = !credit && isAside(before, after, marker, opening);
      // Half of a time (14:32) is neither money nor a count, though it is a
      // copy of a total of its value, as any figure on a line with money is.
      const clock = CLOCK_BEFORE.test(before) || CLOCK_AFTER.test(after);
      figures.push({
        candidate: {
          value,
          token,
          besideCurrency: printed && !clock,
          printedBesideCurrency: printed,
          credit,
          aside,
          count: false,
          mayBeTotal: WORD_AFTER.test(after),
          row,
        },
        start: match.index,
        end: match.index + token.length,
      });
    }
    // A whole number printed bare, with no sign touching it and no cents,
    // grouping or mark, on a line that prints another figure as money, is a
    // count, a size or a code beside a price (Pack of 24 $5.00, SKU 1234
    // $1.45, 緑茶 500ml ¥151), not the line's money, even where it repeats
    // that money's value (TOTAL 14 Card -$14), though it is a copy of it
    // there. It falls to the tier its own shape earns. An aside prices
    // nothing: 合計 980 (内税 ¥72) keeps its 980.
    const signed = signedFigures(line, figures, marker);
    const money = figures.filter(
      ({ candidate }, index) =>
        candidate.besideCurrency &&
        !candidate.aside &&
        (signed[index] || isMoneyShaped(candidate.token)),
    );
    for (const [index, { candidate, start }] of figures.entries()) {
      const count =
        candidate.besideCurrency &&
        !signed[index] &&
        !candidate.credit &&
        !isMoneyShaped(candidate.token) &&
        money.length > 0;
      candidates.push({
        ...candidate,
        besideCurrency: candidate.besideCurrency && !count,
        count,
        // A count of what a price buys stands before the price; one followed
        // by a word of its own, or printed after the line's money (Tax $1.00
        // Total 9), stands where a total does.
        mayBeTotal: count && (candidate.mayBeTotal || money.some(m => m.start < start)),
      });
    }
    opening = UNCLOSED_OPEN.exec(line)?.[0] ?? '';
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
  const counts = candidates.filter(c => c.count);

  for (let index = 0; index < tiers.length; index++) {
    const tier = tiers[index];
    const largest = largestOf(tier.of);
    if (!largest) {
      continue;
    }
    // A labelled aside (Reg $15.00) is never the total while its tier holds a
    // figure printed on its own; where it holds nothing else, it is all the
    // tier gave.
    const pick = largestOf(tier.of.filter(c => !c.aside)) ?? largest;
    const tendered = tenderedDemotion(pick, tier.of, counts);
    const winner = tendered ?? pick;
    const rivals = countsThatMayBeTotal(winner, tier.of, counts);
    // Each of these moves the reading on a rule rather than on anything
    // printed, so each lands under the review bar: passing an aside; keeping
    // one only because its tier holds nothing else while a weaker tier holds
    // a figure printed on its own (Total 12.50 / (Reg $15.00)); and reading a
    // figure a larger count might have been the total in place of (Total 1280
    // Tax ¥116).
    const passedAside =
      pick.value < largest.value ||
      (winner.aside && tiers.slice(index + 1).some(weaker => weaker.of.some(c => !c.aside)));
    const demotion = passedAside
      ? 'aside'
      : rivals.length > 0
        ? 'count'
        : tendered
          ? 'tender'
          : undefined;
    return {
      amount: winner.value,
      confidence: demotion ? tier.confidence * DEMOTION_FACTOR : tier.confidence,
      ...(demotion ? { demotion } : {}),
      ...readDirection(winner, candidates, rivals),
    };
  }

  return { amount: 0, confidence: 0, direction: 'debit', directionConfidence: 0 };
}

/**
 * Whether this figure itself is printed as a negative: a minus or a triangle
 * right before it, or accounting parentheses around it. The mark is read
 * against the figure, never the line, so `Item-7 Total $12.50` and a
 * `(-$1.00 saved)` beside the total say nothing about the total.
 */
function isCreditMarked(before: string, token: string, after: string): boolean {
  if (NEGATIVE_BEFORE.test(before)) {
    return true;
  }
  const opens = OPENS_BEFORE.exec(before);
  const closes = CLOSES_AFTER.exec(after);
  // A bare (2) or (100) is a quantity or a count; parentheses negate money only.
  return !!opens && !!closes && (!!opens[1] || !!closes[1] || isMoneyShaped(token));
}

/** The largest figure, the first printed where two tie. */
function largestOf(candidates: AmountCandidate[]): AmountCandidate | undefined {
  return candidates.reduce<AmountCandidate | undefined>(
    (winner, candidate) => (!winner || candidate.value > winner.value ? candidate : winner),
    undefined,
  );
}

/**
 * Whether this figure is a labelled aside: inside parentheses that hold a word
 * as well as the figure, (Reg $15.00), ($15.00 reg), （定価 ¥1,580）, rather
 * than around the figure alone, which mark it negative. A letter of any script
 * is a word, and no word is read for what it says (ADR 0008). The capitals of
 * a sign (US$) and the code the receipt's currency was read from (USD) are
 * the figure's money, not a word. A figure whose own line holds no
 * parenthesis is read inside the one the line before left open.
 */
function isAside(before: string, after: string, marker: string, opening: string): boolean {
  const opened = UNCLOSED_OPEN.exec(ANY_PARENS.test(before) ? before : `${opening}\n${before}`);
  const closed = UNOPENED_CLOSE.exec(after);
  if (!opened || !closed) {
    return false;
  }
  const inside = `${opened[0].slice(1)} ${closed[0].slice(0, -1)}`.replace(SIGNS, ' ');
  return LETTER.test(marker === '' ? inside : inside.split(marker).join(' '));
}

/**
 * Which figures on a line a currency sign, or the code the receipt's currency
 * was read from, touches: right before the figure, past a minus, a triangle,
 * an opening parenthesis or one space ($12.50, -$12.50, $-12.50, (US$12.50),
 * USD 64.79), or right after it, past a closing parenthesis or one space
 * (2,10 €, 64.79 USD). A sign printed between two figures touches one of
 * them: the one it is printed against where a space parts it from the other
 * (the $ of Item 2 $1.00 is the price's), else the one written like money
 * where the other is bare (2,10 € 3). Where nothing tells the two apart
 * (Summe 12 € 3 Artikel, Total 2 $ 8), it touches both, and both are money.
 */
function signedFigures(
  line: string,
  figures: { candidate: AmountCandidate; start: number; end: number }[],
  marker: string,
): boolean[] {
  const isSign = (text: string) => ONE_SIGN.test(text) || (marker !== '' && text === marker);
  const before = figures.map(({ start }) => {
    const lead = line.slice(0, start).replace(MARK_BEFORE_FIGURE, '');
    return SIGN_LAST.test(lead) || (marker !== '' && lead.endsWith(marker));
  });
  const after = figures.map(({ end }) => {
    const trail = line.slice(end).replace(MARK_AFTER_FIGURE, '');
    return SIGN_FIRST.test(trail) || (marker !== '' && trail.startsWith(marker));
  });
  for (let index = 1; index < figures.length; index++) {
    const first = figures[index - 1];
    const second = figures[index];
    const between = line.slice(first.end, second.start);
    const sign = between.replace(MARK_AFTER_FIGURE, '').replace(MARK_BEFORE_FIGURE, '');
    if (!after[index - 1] || !before[index] || !isSign(sign)) {
      continue;
    }
    const at = between.indexOf(sign);
    const gluedToFirst = !SPACE.test(between.slice(0, at));
    const gluedToSecond = !SPACE.test(between.slice(at + sign.length));
    const firstShaped = isMoneyShaped(first.candidate.token);
    const secondShaped = isMoneyShaped(second.candidate.token);
    const firstOwns =
      gluedToFirst !== gluedToSecond
        ? gluedToFirst
        : firstShaped !== secondShaped
          ? firstShaped
          : undefined;
    if (firstOwns === undefined) {
      continue;
    }
    if (firstOwns) {
      before[index] = false;
    } else {
      after[index - 1] = false;
    }
  }
  return figures.map((_, index) => before[index] || after[index]);
}

/**
 * The counts that might have been the total in place of the figure read: those
 * larger than it, where nothing else in its tier prints that figure, or, where
 * something does, those printed where a total stands (Total 1280 Tax ¥116;
 * 内税 ¥72 合計 980). A total printed bare beside a smaller figure looks like a
 * count beside a price, and a figure printed again proves nothing when the
 * tax beside the total is printed again too (内消費税等 ¥116); a count of what
 * the price beside it buys stands right before it (Pack of 24 $5.00).
 */
function countsThatMayBeTotal(
  winner: AmountCandidate,
  tier: AmountCandidate[],
  counts: AmountCandidate[],
): AmountCandidate[] {
  const printedOnce =
    tier.filter(c => Math.abs(c.value - winner.value) <= TENDER_SUM_TOLERANCE).length <= 1;
  return counts.filter(c => c.value > winner.value && (printedOnce || c.mayBeTotal));
}

/**
 * Which way the winning total moved, from every copy of it the receipt prints
 * as money, within the same half cent the tendered sum allows. A refund slip
 * can repeat its total unmarked on the card line, and a sale can print its
 * tender line as a negative, so the copies have to agree: all marked is a
 * credit, a disagreement stays a purchase graded for a second look, and
 * nothing marked is the plain purchase. An ambiguous total never becomes a
 * credit.
 *
 * "As money" means a figure on a line that prints a currency mark, or one
 * written like money, whatever its line's money made of it: a size on a
 * priced line (10m -$10.00) counts as one, and so does half of a time on the
 * total's own line, or on another line that prints money (the 14 of 14:32
 * TOTAL -$14.00). That leaves such a refund a purchase graded 0.3 rather than
 * let a sale whose bare total a time repeats read as a refund (Total 32 /
 * 14:32 Card -$32.00). A time on a line of its own prints no money and is no
 * copy. A total read from the plain numbers has no money to compare with, so
 * every figure of its value is a copy.
 *
 * A count that might have been the total carries no mark of its own, so the
 * marks do not agree either where it is printed on a line that prints the
 * total as well (Total 12 Tax -$0.96), or where it stands where a total does,
 * on any line (Coupon -$3.00 over Tax $1.00 Total 12).
 */
function readDirection(
  winner: AmountCandidate,
  candidates: AmountCandidate[],
  rivals: AmountCandidate[],
): Pick<AmountReading, 'direction' | 'directionConfidence'> {
  const winnerIsMoney = isPrintedAsMoney(winner);
  const copies = candidates.filter(
    c =>
      Math.abs(c.value - winner.value) <= TENDER_SUM_TOLERANCE &&
      (!winnerIsMoney || isPrintedAsMoney(c)),
  );
  const rivalled = rivals.some(
    rival => rival.mayBeTotal || copies.some(copy => copy.row === rival.row),
  );
  const marked = copies.filter(c => c.credit).length;
  if (marked === copies.length && !rivalled) {
    return { direction: 'credit', directionConfidence: CREDIT_MARK_GRADE };
  }
  return { direction: 'debit', directionConfidence: marked > 0 ? TWINNED_MARK_GRADE : 0 };
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
 * A figure the first two tiers would read but for what its line's money made
 * of it: on a line that prints a currency mark, or written like money.
 */
function isPrintedAsMoney(candidate: AmountCandidate): boolean {
  return candidate.printedBesideCurrency || isMoneyShaped(candidate.token);
}

/**
 * A number with no money marks on it at all. A leading zero means it was padded
 * rather than counted, which no total ever is.
 */
function isPlainNumber(token: string): boolean {
  return !isMoneyShaped(token) && token.length <= MAX_PLAIN_DIGITS && !/^0\d/.test(token);
}
