#!/usr/bin/env node
/**
 * Reads the same generated receipts on two versions of the device's text
 * parser and counts what moved (#527, #528, #530, ADR 0188; #524, #525, #526,
 * #529, ADR 0189).
 *
 * A change to `src/app/core/services/receipt-text-parser.ts` is held to one
 * rule before any other: no receipt may newly read silently, which is a wrong
 * amount graded at or over the review bar, a refund read as a purchase graded
 * 0, or a purchase read as a credit graded 0.5 or more (the stricter sense of
 * ADR 0186, as `silentStrictly` in receipt-text-parser.battery.spec.ts). The
 * battery holds that for the receipts someone wrote down. This holds it for
 * receipts nobody wrote down: classes built for the rules that have gone wrong
 * before, and seeded sets that mix them with the noise a real receipt prints.
 *
 *   node scripts/measure-receipt-parser.mjs --base origin/main
 *   node scripts/measure-receipt-parser.mjs --base origin/main --day-first
 *   TZ=Asia/Tokyo node scripts/measure-receipt-parser.mjs --base origin/main
 *
 * `--base <ref>` is the version to compare against (default `HEAD`); the other
 * side is the working tree. `--seed`, `--per-class`, `--sets` and `--size`
 * change how much is generated; the defaults are the ones the records quote.
 * `--day-first` reads an ambiguous date as the day before the month, the way a
 * device outside the US does. `--grades-before-0189` grades the base side's
 * model lane as it was graded before ADR 0189. The zone is the process's own,
 * so set `TZ`. The clock is held at noon on 30 October 2026, the battery's.
 *
 * Both versions are loaded from source text. The parser's one import is a
 * date helper whose own module reaches for the Firestore SDK, so the import
 * line is replaced by the helper's five lines and the result is transpiled
 * with the repository's own TypeScript.
 *
 * The exit code is 1 where a receipt newly reads silently in any class,
 * layout or set, and 0 otherwise. Right readings newly flagged, and right
 * readings that became wrong and flagged, are counted and printed, never
 * failed: they are costs for a record to state. So are the purchases whose
 * type is newly asked about, and, in the classes that print a date the class
 * knows, the dates read right, lost, and newly read wrong at or over the bar.
 *
 * The model lane is counted the way NativeReceiptService grades it
 * (`agreedAmountGrade` and `disputedAmountGrade` in native-receipt.service.ts):
 * for every distinct figure a receipt prints, a model that answers that figure
 * keeps the parser's grade, is lifted to 0.8 or is disputed at 0.5. A wrong
 * answer left at 0.7 or more is a silent one.
 *
 * `--self-test` proves the generator repeats itself, the loader reads both a
 * git ref and the working tree, and the counting catches a planted
 * regression. The ci job runs it. The measurement itself is run by hand,
 * because its checkout is one commit deep and holds no version to compare
 * against.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const SELF = 'scripts/measure-receipt-parser.mjs';
const PARSER = 'src/app/core/services/receipt-text-parser.ts';
const DATE_IMPORT = "import { localDateFromParts } from '../utils/transaction-date.utils';";
const DATE_HELPER = `function localDateFromParts(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }
  return date;
}`;

/** The review bar, and the grades the model lane hands out around it. */
const VERIFY_FIELD_THRESHOLD = 0.7;
const DEMOTION_FACTOR = 0.75;
const MODEL_READ_GRADE = 0.8;
const REVIEW_AMOUNT_CONFIDENCE = 0.5;

const LAYOUTS = ['joined', 'split'];

// ---------------------------------------------------------------------------
// Loading a version of the parser
// ---------------------------------------------------------------------------

/**
 * What stands in front of the parser's source: a clock that does not move and
 * a device whose day order is the one asked for. Both shadow the globals
 * inside the loaded module only.
 */
function shim(dayFirst) {
  return `
const __NOW = new globalThis.Date(2026, 9, 30, 12).getTime();
class Date extends globalThis.Date {
  constructor(...args) {
    if (args.length === 0) {
      super(__NOW);
    } else {
      super(...args);
    }
  }
  static now() {
    return __NOW;
  }
}
const Intl = Object.create(globalThis.Intl, {
  DateTimeFormat: {
    value: function (_locale, options) {
      return new globalThis.Intl.DateTimeFormat(${dayFirst ? "'en-GB'" : "'en-US'"}, options);
    },
  },
  supportedValuesOf: { value: key => globalThis.Intl.supportedValuesOf(key) },
  NumberFormat: { value: globalThis.Intl.NumberFormat },
});
`;
}

/** A parser from its TypeScript source, with the day order it should assume. */
async function loadParser(source, dayFirst) {
  if (!source.includes(DATE_IMPORT)) {
    throw new Error(`${SELF}: ${PARSER} no longer imports its date helper the way this loader replaces`);
  }
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const { outputText } = ts.transpileModule(source.replace(DATE_IMPORT, DATE_HELPER), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const code = shim(dayFirst) + outputText;
  const module = await import(`data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`);
  return module.parseReceiptOcrText;
}

function sourceAt(ref) {
  return execFileSync('git', ['show', `${ref}:${PARSER}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function sourceInTree() {
  return readFileSync(new URL(`../${PARSER}`, import.meta.url), 'utf8');
}

// ---------------------------------------------------------------------------
// Generating receipts
// ---------------------------------------------------------------------------

/** A small seeded generator: the same seed prints the same receipts. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CURRENCIES = [
  { code: 'USD', sign: '$', decimals: 2, print: text => `$${text}`, spaced: text => `$ ${text}`, trailing: text => `${text} USD`, mark: '.', group: ',' },
  { code: 'EUR', sign: '€', decimals: 2, print: text => `${text} €`, spaced: text => `€ ${text}`, trailing: text => `${text} €`, mark: ',', group: '.' },
  { code: 'JPY', sign: '¥', decimals: 0, print: text => `¥${text}`, spaced: text => `¥ ${text}`, trailing: text => `${text}円`, mark: '.', group: ',' },
  { code: 'KRW', sign: '₩', decimals: 0, print: text => `₩${text}`, spaced: text => `₩ ${text}`, trailing: text => `${text}원`, mark: '.', group: ',' },
];

/**
 * The ways a receipt puts its currency beside a price: the sign glued before
 * it, the sign spaced before it, the code before it, and a sign, a code or the
 * currency's letters after it.
 */
const STYLES = {
  glued: (currency, text) => `${currency.sign}${text}`,
  spaced: (currency, text) => `${currency.sign} ${text}`,
  code: (currency, text) => `${currency.code} ${text}`,
  trailing: (currency, text) => currency.trailing(text),
};

const pad = number => String(number).padStart(2, '0');

/** The ways a receipt prints a date, by the order of its parts. */
const DATE_FORMATS = {
  'm/d/yy': date => `${date.month}/${date.day}/${pad(date.year % 100)}`,
  'mm/dd/yyyy': date => `${pad(date.month)}/${pad(date.day)}/${date.year}`,
  'mm/dd/yy': date => `${pad(date.month)}/${pad(date.day)}/${pad(date.year % 100)}`,
  'dd.mm.yy': date => `${pad(date.day)}.${pad(date.month)}.${pad(date.year % 100)}`,
  'dd.mm.yyyy': date => `${pad(date.day)}.${pad(date.month)}.${date.year}`,
  'dd/mm/yy': date => `${pad(date.day)}/${pad(date.month)}/${pad(date.year % 100)}`,
  'd.m.yy': date => `${date.day}.${date.month}.${pad(date.year % 100)}`,
  'dd-mm-yyyy': date => `${pad(date.day)}-${pad(date.month)}-${date.year}`,
  'mm dd yy': date => `${pad(date.month)} ${pad(date.day)} ${pad(date.year % 100)}`,
  'yyyy-mm-dd': date => `${date.year}-${pad(date.month)}-${pad(date.day)}`,
  'yyyy/mm/dd': date => `${date.year}/${pad(date.month)}/${pad(date.day)}`,
};
const YEAR_LAST_FORMATS = Object.keys(DATE_FORMATS).filter(name => !name.startsWith('yyyy'));
const UNSPACED_YEAR_LAST_FORMATS = YEAR_LAST_FORMATS.filter(name => !name.includes(' '));

const NOTES = {
  USD: [5, 10, 20, 50, 100, 200, 500],
  EUR: [5, 10, 20, 50, 100, 200, 500],
  JPY: [500, 1000, 2000, 5000, 10000, 20000, 50000],
  KRW: [1000, 5000, 10000, 50000, 100000],
};

function round(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/** The tools one receipt is written with, and the figures it ends up printing. */
function writer(random, currency = CURRENCIES[Math.floor(random() * CURRENCIES.length)]) {
  const printed = new Set();
  const int = (low, high) => low + Math.floor(random() * (high - low + 1));
  const chance = probability => random() < probability;
  const of = list => list[int(0, list.length - 1)];
  /** The digits of an amount, grouped and with cents as the currency prints them. */
  const digits = value => {
    printed.add(round(value, 2));
    const [whole, cents] = value.toFixed(currency.decimals).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, currency.group);
    return cents === undefined ? grouped : `${grouped}${currency.mark}${cents}`;
  };
  /** A whole number as a count is printed: bare, and no figure of the money. */
  const count = value => {
    printed.add(value);
    return String(value);
  };
  const price = () =>
    currency.decimals === 0
      ? currency.code === 'KRW'
        ? int(5, 400) * 100
        : int(80, 9800)
      : round(int(50, 9000) / 100, 2);
  const roundPrice = () =>
    currency.decimals === 0 ? int(1, 40) * (currency.code === 'KRW' ? 1000 : 500) : int(1, 30) * 5;
  const noteOver = total => NOTES[currency.code].find(note => note > total) ?? Math.ceil(total / 1000) * 1000 + 1000;
  // One way of printing the currency for the whole receipt, drawn only when a
  // class asks for it, so the classes that never do print what they always did.
  let style;
  const styled = text => {
    style ??= of(Object.keys(STYLES));
    return STYLES[style](currency, text);
  };
  return {
    currency,
    int,
    chance,
    of,
    price,
    roundPrice,
    noteOver,
    count,
    /** Money beside its sign. */
    money: value => currency.print(digits(value)),
    /** Money printed negative. */
    minus: value => `-${currency.print(digits(value))}`,
    /** Money in accounting parentheses. */
    parens: value => `(${currency.print(digits(value))})`,
    /** Money with no currency mark. */
    bare: value => digits(value),
    /** Money beside its currency the one way this receipt prints it. */
    styled: value => styled(digits(value)),
    /** The same, printed negative. */
    styledMinus: value => `-${styled(digits(value))}`,
    /** A whole price, or one with cents where the currency has them. */
    wholePrice: () => (currency.decimals === 0 ? price() : int(1, 60)),
    /** A day no later than the held clock's: a receipt is never dated ahead. */
    date: () => {
      const year = of([2023, 2024, 2025, 2026]);
      return { year, month: year === 2026 ? int(1, 10) : int(1, 12), day: int(1, 28) };
    },
    /** A date in one of the named formats. */
    dated: (date, formats = YEAR_LAST_FORMATS) => DATE_FORMATS[of(formats)](date),
    /** A sign spaced from a bare whole number on both sides. */
    spacedSign: value => currency.spaced(count(value)),
    tax: value => round(value * 0.08, currency.decimals),
    plus: (a, b) => round(a + b, currency.decimals),
    less: (a, b) => round(a - b, currency.decimals),
    figures: () => [...printed],
  };
}

const ITEMS = ['Milk', 'Bread', 'Latte', 'Tea', 'Bento', 'Rice', 'Soap', 'Jacket', 'Pen', 'Cake'];

function items(w, howMany) {
  return Array.from({ length: howMany }, () => ({ name: w.of(ITEMS), price: w.price() }));
}

function sum(w, list) {
  return list.reduce((total, item) => w.plus(total, item.price), 0);
}

function receipt(w, lines, amount, kind = 'purchase') {
  return { text: ['Shop', ...lines].join('\n'), amount, kind, figures: w.figures() };
}

/** A receipt whose class knows the date it prints, or (null) that it prints none. */
function dated(made, date) {
  return { ...made, date };
}

function asRefund(made) {
  return { ...made, text: made.text.replace('Shop', 'REFUND'), kind: 'refund' };
}

/** Item lines the way one receipt prints its currency, and what they add up to. */
function styledItems(w, howMany, negative = false) {
  const list = items(w, howMany);
  const lines = list.map(item => {
    const money = negative ? w.styledMinus(item.price) : w.styled(item.price);
    return w.chance(0.35)
      ? `${item.name} ${w.count(w.int(1, 4))} ${money}`
      : w.chance(0.15)
        ? `${item.name} ${w.count(w.int(2, 3))} x ${w.bare(item.price)} ${money}`
        : `${item.name} ${money}`;
  });
  return { lines, total: sum(w, list) };
}

const clock = w => `${pad(w.int(0, 23))}:${pad(w.int(0, 59))}`;

/**
 * The classes. Each is one shape a rule of the parser has to tell from its
 * neighbours, written without regard to which way the parser reads it.
 */
const CLASSES = {
  plain(w) {
    const list = items(w, w.int(1, 3));
    const lines = list.map(item =>
      w.chance(0.3)
        ? `${item.name} ${w.count(w.int(1, 4))} ${w.money(item.price)}`
        : w.chance(0.15)
          ? `Pack of ${w.count(w.of([6, 12, 24]))} ${w.money(item.price)}`
          : `${item.name} ${w.money(item.price)}`,
    );
    const subtotal = sum(w, list);
    if (w.chance(0.5)) {
      const tax = w.tax(subtotal);
      const total = w.plus(subtotal, tax);
      return receipt(w, [...lines, `Subtotal ${w.money(subtotal)}`, `Tax ${w.money(tax)}`, `Total ${w.money(total)}`], total);
    }
    return receipt(w, [...lines, `Total ${w.money(subtotal)}`], subtotal);
  },

  refund(w) {
    const list = items(w, w.int(1, 2));
    const total = sum(w, list);
    const lines = list.map(item => `${item.name} ${w.minus(item.price)}`);
    const totalLine = w.chance(0.5) ? `Total ${w.minus(total)}` : `Total ${w.parens(total)}`;
    const { text, amount, figures } = receipt(w, [...lines, totalLine], total, 'refund');
    return { text: text.replace('Shop', 'REFUND'), amount, kind: 'refund', figures };
  },

  cash(w) {
    const total = w.price();
    const cash = w.noteOver(total);
    return receipt(
      w,
      [`Item ${w.money(total)}`, `Total ${w.money(total)}`, `Cash ${w.money(cash)}`, `Change ${w.money(w.less(cash, total))}`],
      total,
    );
  },

  cashRoundTotal(w) {
    const total = w.roundPrice();
    const cash = w.noteOver(total);
    const lines = w.chance(0.5) ? [`Item ${w.money(total)}`] : [];
    return receipt(
      w,
      [...lines, `Total ${w.money(total)}`, `Cash ${w.money(cash)}`, `Change ${w.money(w.less(cash, total))}`],
      total,
    );
  },

  cashBareTotal(w) {
    const list = items(w, w.int(1, 2));
    const subtotal = sum(w, list);
    const tax = w.tax(subtotal);
    const total = w.plus(subtotal, tax);
    const cash = w.noteOver(total);
    return receipt(
      w,
      [
        ...list.map(item => `${item.name} ${w.count(w.int(1, 3))} ${w.money(item.price)}`),
        `Total ${w.bare(total)}`,
        `Tax ${w.money(tax)}`,
        `Cash ${w.money(cash)}`,
        `Change ${w.money(w.less(cash, total))}`,
      ],
      total,
    );
  },

  cashBareChange(w) {
    const list = items(w, w.int(1, 2));
    const total = sum(w, list);
    const cash = w.noteOver(total);
    return receipt(
      w,
      [
        ...list.map(item => `${item.name} ${w.money(item.price)}`),
        `Total ${w.money(total)}`,
        `Cash ${w.money(cash)}`,
        `Change ${w.bare(w.less(cash, total))}`,
      ],
      total,
    );
  },

  discountMarked(w) {
    return discount(w, w.chance(0.5) ? 'minus' : 'parens');
  },

  discountUnmarked(w) {
    return discount(w, 'money');
  },

  totalAboveParts(w) {
    const subtotal = w.price();
    const tax = w.tax(subtotal);
    const total = w.plus(subtotal, tax);
    const parts = [`Subtotal ${w.money(subtotal)}`, `Tax ${w.money(tax)}`];
    return receipt(w, [`Item ${w.money(subtotal)}`, `Total ${w.money(total)}`, ...(w.chance(0.5) ? parts : parts.reverse())], total);
  },

  totalAboveRoundParts(w) {
    const larger = w.roundPrice() * 9;
    const smaller = w.roundPrice();
    const total = w.plus(larger, smaller);
    const parts = [`Net ${w.money(larger)}`, `Tax ${w.money(smaller)}`];
    return receipt(w, [`Total ${w.money(total)}`, ...(w.chance(0.5) ? parts : parts.reverse())], total);
  },

  totalAboveRateBases(w) {
    const first = w.price();
    const second = w.price();
    const total = w.plus(first, second);
    return receipt(w, [`Total ${w.money(total)}`, `8% base ${w.money(first)}`, `10% base ${w.money(second)}`], total);
  },

  bareTotal(w) {
    const total = w.int(3, 400);
    const tax = round((total * 8) / 108, 2);
    const subtotal = round(total - tax, 2);
    const usd = writer(() => 0, CURRENCIES[0]);
    const between = w.of(['', ' =', ' 8%']);
    const totalLine = `Total ${usd.count(total)}${between} ${usd.money(tax)}`;
    const shape = w.int(0, 2);
    const lines =
      shape === 0
        ? [totalLine, `Tax ${usd.money(tax)}`]
        : shape === 1
          ? [`Item ${usd.money(subtotal)}`, `Subtotal ${usd.money(subtotal)}`, totalLine]
          : [totalLine, `Cash ${usd.money(usd.noteOver(total))}`, `Change ${usd.money(usd.less(usd.noteOver(total), total))}`];
    return receipt(usd, lines, total);
  },

  pricedLines(w) {
    const list = items(w, w.int(1, 3));
    const lines = list.map(item => {
      const shape = w.int(0, 3);
      return shape === 0
        ? `${item.name} ${w.count(w.int(1, 48))} ${w.money(item.price)}`
        : shape === 1
          ? `SKU ${w.count(w.int(1000, 9999))} ${w.money(item.price)}`
          : shape === 2
            ? `${item.name} ${w.count(w.of([250, 500, 750]))}ml ${w.money(item.price)}`
            : `${item.name} ${w.money(item.price)} ${w.count(w.int(1, 9))}`;
    });
    const total = sum(w, list);
    return receipt(w, [...lines, `Total ${w.money(total)}`], total);
  },

  twoItems(w) {
    const list = items(w, 2);
    const total = sum(w, list);
    const lines = list.map(item =>
      w.chance(0.5) ? `${item.name} ${w.count(w.int(1, 24))} ${w.money(item.price)}` : `${item.name} ${w.money(item.price)}`,
    );
    const card = w.chance(0.3) ? [`Card ${w.money(total)}`] : [];
    return receipt(w, [...lines, `Total ${w.money(total)}`, ...card], total);
  },

  spacedSign(w) {
    const list = Array.from({ length: w.int(1, 3) }, () => ({ name: w.of(ITEMS), count: w.int(2, 30), price: w.int(2, 40) }));
    const total = list.reduce((all, item) => all + item.price, 0);
    const lines = list.map(item => `${item.name} ${w.count(item.count)} ${w.spacedSign(item.price)}`);
    const shape = w.int(0, 2);
    const totalLine =
      shape === 0
        ? `Total ${w.spacedSign(total)}`
        : shape === 1
          ? `Total ${w.currency.print(w.count(total))}`
          : `Total ${w.count(list.length)} ${w.spacedSign(total)}`;
    return receipt(w, [...lines, totalLine], total);
  },

  // A date printed after the total on the total's own line, under each way of
  // printing the currency: the shape where a price starts a run that only
  // looks like a date.
  totalThenDate(w) {
    const refund = w.chance(0.25);
    const { lines, total } = styledItems(w, w.int(1, 2), refund);
    const date = w.date();
    const totalLine = `Total ${refund ? w.styledMinus(total) : w.styled(total)} ${w.dated(date)}`;
    const out = [...(refund || w.chance(0.3) ? [] : lines), totalLine];
    const under = w.int(0, 2);
    if (under === 1 && !refund) {
      const cash = w.noteOver(total);
      out.push(`Cash ${w.styled(cash)}`, `Change ${w.styled(w.less(cash, total))}`);
    }
    if (under === 2) {
      out.push(`Card ${refund ? w.styledMinus(total) : w.styled(total)}`);
    }
    const made = dated(receipt(w, out, total), date);
    return refund ? asRefund(made) : made;
  },

  dateElsewhere(w) {
    const { lines, total } = styledItems(w, w.int(1, 3));
    const date = w.date();
    const printed = w.dated(date, Object.keys(DATE_FORMATS));
    const totalLine = `Total ${w.styled(total)}`;
    const where = w.int(0, 3);
    const out =
      where === 0
        ? [printed, ...lines, totalLine]
        : where === 1
          ? [...lines, `${printed} ${totalLine}`]
          : where === 2
            ? [...lines, totalLine, printed]
            : [`${printed} ${clock(w)}`, ...lines, totalLine];
    return dated(receipt(w, out, total), date);
  },

  cardLineThenDate(w) {
    const total = w.chance(0.5) ? w.wholePrice() : w.price();
    const date = w.date();
    return dated(
      receipt(
        w,
        [
          `Item ${w.styled(total)}`,
          `Total ${w.styled(total)}`,
          `Card ****${w.int(1000, 9999)} ${w.styled(total)} ${w.dated(date)}`,
        ],
        total,
      ),
      date,
    );
  },

  wholePriceThenDate(w) {
    const price = w.currency.decimals === 0 ? w.int(2, 31) * 10 : w.int(2, 31);
    const quantity = w.int(2, 4);
    const total = price * quantity;
    const date = w.date();
    const refund = w.chance(0.3);
    const money = value => (refund ? w.styledMinus(value) : w.styled(value));
    const made = dated(
      receipt(w, [`${w.of(ITEMS)} ${w.count(quantity)} ${money(price)} ${w.dated(date)}`, `Total ${money(total)}`], total),
      date,
    );
    return refund ? asRefund(made) : made;
  },

  yearFirstTwoDigits(w) {
    const date = w.date();
    const mark = w.of(['.', '/', '-']);
    const printed = [pad(date.year % 100), pad(date.month), pad(date.day)].join(mark);
    const refund = w.chance(0.3);
    const { lines, total } = styledItems(w, w.int(1, 2), refund);
    const head = w.chance(0.5) ? `${printed} ${w.currency.code}` : printed;
    const made = dated(receipt(w, [head, ...lines, `Total ${refund ? w.styledMinus(total) : w.styled(total)}`], total), date);
    return refund ? asRefund(made) : made;
  },

  wrappedDate(w) {
    const date = w.date();
    const year = w.chance(0.5) ? String(date.year) : pad(date.year % 100);
    const mark = w.of(['.', '/', '-']);
    const day = pad(date.day);
    const month = pad(date.month);
    const printed = w.of([
      `${day}${mark}${month}${mark}\n${year}`,
      `${day}${mark}${month}\n${mark}${year}`,
      `${day}${mark}${month}\n${year}`,
      `${day}${mark}\n${month}${mark}${year}`,
      `${day}${mark}${month}${mark}\n${year} ${clock(w)}`,
    ]);
    const refund = w.chance(0.3);
    const { lines, total } = styledItems(w, w.int(1, 2), refund);
    const totalLine = `Total ${refund ? w.styledMinus(total) : w.styled(total)}`;
    const out = w.chance(0.5) ? [printed, ...lines, totalLine] : [...lines, `${totalLine} ${printed}`];
    const made = dated(receipt(w, out, total), date);
    return refund ? asRefund(made) : made;
  },

  dateGluedByMark(w) {
    const date = w.date();
    const printed = w.dated(date, ['mm/dd/yy', 'dd.mm.yyyy', 'dd/mm/yy', 'dd.mm.yy', 'dd-mm-yyyy', 'yyyy-mm-dd']);
    const refund = w.chance(0.4);
    const { lines, total } = styledItems(w, w.int(1, 2), refund);
    const head = `${w.of(['Bon', 'No', 'Ref'])} ${w.int(100, 9999)}${w.of(['.', ','])}${printed}`;
    const made = dated(receipt(w, [head, ...lines, `Total ${refund ? w.styledMinus(total) : w.styled(total)}`], total), date);
    return refund ? asRefund(made) : made;
  },

  dateGluedAfterSign(w) {
    const date = w.date();
    const printed = `${w.currency.sign}${w.dated(date, UNSPACED_YEAR_LAST_FORMATS)}`;
    const { lines, total } = styledItems(w, w.int(1, 2));
    const totalLine = `Total ${w.styled(total)}`;
    const where = w.int(0, 2);
    const out =
      where === 0
        ? [printed, ...lines, totalLine]
        : where === 1
          ? [`Date:${printed}`, ...lines, totalLine]
          : [...lines, `${printed} ${totalLine}`];
    return dated(receipt(w, out, total), date);
  },

  // Nothing here is a date: figures and codes a date rule might take for one.
  noDate(w) {
    const { lines, total } = styledItems(w, w.int(1, 3));
    const traps = [
      () => `TEL ${pad(w.int(1, 9))}-${w.int(10, 99)}-${w.int(10, 99)}`,
      () => `Lot ${w.int(13, 31)}.${pad(w.int(1, 12))}.${w.int(27, 40)}`,
      () => `Art ${w.int(27, 40)}.${pad(w.int(13, 31))}.${pad(w.int(1, 28))}`,
      () => `Ref ${w.int(1000, 9999)}.${w.int(1, 28)}/${w.int(13, 31)}/${w.int(27, 99)}`,
      () => `${w.int(1, 9)} x ${w.int(1, 9)}.${w.int(1, 9)}.\n${w.int(1, 40)} pcs`,
      () => `Kasse ${w.int(1, 31)} ${w.int(13, 31)}.\n${w.int(27, 99)}`,
      () => `${w.int(13, 40)} ${w.int(13, 28)} ${w.int(13, 31)} ${w.int(1, 30)}`,
      () => `Qty ${w.int(13, 31)} ${w.int(13, 28)}.${pad(w.int(1, 12))}`,
      () => `Table ${w.int(1, 30)} Guests ${w.int(1, 9)}`,
      () => `#${w.int(13, 31)}-${w.int(13, 31)}-${w.int(1, 99)}`,
    ];
    const out = [...lines];
    for (let extra = w.int(1, 2); extra > 0; extra--) {
      out.splice(w.int(0, out.length), 0, w.of(traps)());
    }
    out.push(`Total ${w.styled(total)}`);
    return dated(receipt(w, out, total), null);
  },

  // A total printed with no currency mark beside lines that print one.
  unmarkedTotal(w) {
    const list = items(w, w.int(1, 3));
    const subtotal = sum(w, list);
    const tax = w.tax(subtotal);
    const total = w.plus(subtotal, tax);
    const lines = list.map(item =>
      w.chance(0.3) ? `${item.name} ${w.count(w.int(1, 4))} ${w.money(item.price)}` : `${item.name} ${w.money(item.price)}`,
    );
    const shape = w.int(0, 3);
    if (shape === 0) {
      return receipt(w, [...lines, `Tax ${w.money(tax)}`, `Total ${w.bare(total)}`], total);
    }
    if (shape === 1) {
      return receipt(w, [...lines, `Subtotal ${w.money(subtotal)}`, `Total ${w.bare(total)}`, `Tax ${w.money(tax)}`], total);
    }
    if (shape === 2) {
      return receipt(w, [...lines, `Total ${w.bare(subtotal)}`], subtotal);
    }
    return receipt(
      w,
      [...lines, `Subtotal ${w.money(subtotal)}`, `Tax ${w.money(tax)}`, `Total ${w.bare(total)}`, `Card ${w.bare(total)}`],
      total,
    );
  },

  // What the rule for an unmarked total costs: a larger figure with no mark
  // printed under a total that has one.
  balanceAfterTotal(w) {
    const list = items(w, w.int(1, 2));
    const total = sum(w, list);
    const lines = list.map(item => `${item.name} ${w.money(item.price)}`);
    const balance = w.chance(0.5) ? w.plus(total, w.price()) : w.int(1000, 9999);
    const label = w.of(['Points balance', 'Card balance', 'Balance', 'Points']);
    return receipt(w, [...lines, `Total ${w.money(total)}`, `${label} ${w.bare(balance)}`], total);
  },

  asideRegular(w) {
    const list = items(w, w.int(1, 2));
    const total = sum(w, list);
    const regular = w.plus(total, w.price());
    const lines = list.map(item => `${item.name} ${w.money(item.price)}`);
    const aside = [
      () => `(Reg ${w.money(regular)})`,
      () => `(Reg ${w.money(regular)}`,
      () => `(REG${w.money(regular)})`,
      () => `(${w.money(regular)} reg)`,
      () => `(You saved ${w.money(w.less(regular, total))})`,
    ][w.int(0, 4)]();
    const totalLine = `Total ${w.money(total)}`;
    return receipt(w, w.chance(0.5) ? [...lines, totalLine, aside] : [...lines, aside, totalLine], total);
  },

  asideInclTax(w) {
    const list = items(w, w.int(1, 2));
    const subtotal = sum(w, list);
    const tax = w.tax(subtotal);
    const total = w.plus(subtotal, tax);
    const lines = list.map(item => `${item.name} ${w.money(item.price)}`);
    const last = [
      () => `Total ${w.money(total)} (incl. tax ${w.money(tax)})`,
      () => `Total ${w.money(total)} (incl. tax ${w.money(tax)}`,
      () => `Total (incl. tax ${w.money(total)}`,
    ][w.int(0, 2)]();
    return receipt(w, [...lines, last], total);
  },

  refundAside(w) {
    const list = items(w, w.int(0, 2));
    const total = list.length > 0 ? sum(w, list) : w.price();
    const lines = list.map(item =>
      w.chance(0.5) ? `${item.name} ${w.money(item.price)}` : `${item.name} ${w.minus(item.price)}`,
    );
    const last = [() => `(Total ${w.money(total)})`, () => `(Refund ${w.minus(total)})`, () => w.parens(total)][w.int(0, 2)]();
    return asRefund(receipt(w, [...lines, last], total));
  },

  // No currency sign anywhere, only the code beside the date or the time.
  codeOnly(w) {
    const list = items(w, w.int(1, 3));
    const total = sum(w, list);
    const code = w.currency.code;
    const head = w.of([`15.01.2026 14:32 ${code}`, `2026-01-15 ${code}`, `13.01.25 ${code}`, `14:32 ${code}`, `2026-01-15 09:05 ${code}`]);
    const lines = list.map(item =>
      w.chance(0.3) ? `${item.name} ${w.count(w.int(1, 4))} ${w.bare(item.price)}` : `${item.name} ${w.bare(item.price)}`,
    );
    const out = [head, ...lines, `Total ${w.bare(total)}`];
    if (w.chance(0.5)) {
      const cash = w.noteOver(total);
      out.push(`Cash ${w.bare(cash)}`, `Change ${w.bare(w.less(cash, total))}`);
    }
    return receipt(w, out, total);
  },

  noMarkAtAll(w) {
    const list = items(w, w.int(1, 3));
    const total = sum(w, list);
    const out = [...list.map(item => `${item.name} ${w.bare(item.price)}`), `Total ${w.bare(total)}`];
    if (w.chance(0.5)) {
      const cash = w.noteOver(total);
      out.push(`Cash ${w.bare(cash)}`, `Change ${w.bare(w.less(cash, total))}`);
    }
    return receipt(w, out, total);
  },
};

/** Items, an optional subtotal, a saving printed one of three ways, an optional tax, the total. */
function discount(w, form) {
  const list = items(w, w.int(1, 2));
  const subtotal = sum(w, list);
  const saving = round(Math.max(subtotal * (w.int(5, 60) / 100), w.currency.decimals === 0 ? 1 : 0.01), w.currency.decimals);
  const label = w.of(['Coupon', 'Discount', 'Gift card', 'Deposit', 'Points', 'You saved']);
  const after = w.less(subtotal, saving);
  const lines = list.map(item =>
    w.chance(0.3) ? `${item.name} ${w.count(w.int(1, 3))} ${w.money(item.price)}` : `${item.name} ${w.money(item.price)}`,
  );
  if (w.chance(0.5)) {
    lines.push(`Subtotal ${w.money(subtotal)}`);
  }
  lines.push(`${label} ${w[form](saving)}`);
  let total = after;
  if (w.chance(0.4)) {
    const tax = w.tax(after);
    total = w.plus(after, tax);
    lines.push(`Tax ${w.money(tax)}`);
  }
  lines.push(`Total ${w.money(total)}`);
  if (w.chance(0.2)) {
    lines.push(`Card ${w.money(total)}`);
  }
  return receipt(w, lines, total);
}

const NOISE = [
  clock,
  w => `2026-${pad(w.int(1, 10))}-${pad(w.int(1, 28))}`,
  // No later than the held clock's month: a receipt prints no date ahead.
  w => `${pad(w.int(1, 10))}/${pad(w.int(1, 28))}/${w.of(['25', '26', '2026'])}`,
  w => `VISA ****${w.int(1000, 9999)}`,
  w => `TEL 03-${w.int(1000, 9999)}-${w.int(1000, 9999)}`,
  w => `No. ${w.int(100000, 999999)}`,
];

/** A line that ends in a date's mark, and one that starts with it: the two halves of a wrapped date. */
const WRAPS_ON = /\d[./-]$/;
const WRAPPED_FROM = /^[./-]\d/;

/**
 * One receipt of a seeded set: any class, with the lines a real receipt
 * prints around its money, and now and then with every currency sign gone.
 */
function mixed(random) {
  const w = writer(random);
  const names = Object.keys(CLASSES);
  const made = CLASSES[w.of(names)](w);
  const lines = made.text.split('\n');
  for (let extra = w.int(0, 3); extra > 0; extra--) {
    const at = w.int(1, lines.length);
    const line = w.of(NOISE)(w);
    // A date OCR wrapped is two lines of one print: nothing comes between them.
    if (!WRAPS_ON.test(lines[at - 1]) && !WRAPPED_FROM.test(lines[at] ?? '')) {
      lines.splice(at, 0, line);
    }
  }
  const text = lines.join('\n');
  // The noise prints dates of its own, so a set judges no date.
  return { ...made, date: undefined, text: w.chance(0.1) ? text.replace(/\s?[$€¥₩]\s?/gu, ' ').replace(/ +/g, ' ') : text };
}

/** Every line that is not an ISO date line becomes its label and its last figure, as the battery splits them. */
function split(text) {
  return text
    .split('\n')
    .map(line => {
      const parts = /^(.*\S)\s+(\S*\d\S*)$/u.exec(line);
      return parts && !/^\d{4}-\d\d-\d\d/.test(line) ? `${parts[1]}\n${parts[2]}` : line;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

function sameAmount(a, b) {
  return Math.abs(a - b) < 0.005;
}

/** One reading against what the receipt was written to say. */
function judge(result, made) {
  const wrongAmount = !sameAmount(result.amount, made.amount);
  const flagged = result.amountConfidence < VERIFY_FIELD_THRESHOLD;
  const silent =
    (wrongAmount && !flagged) ||
    (made.kind === 'refund' && result.direction === 'debit' && result.directionConfidence === 0) ||
    (made.kind === 'purchase' && result.direction === 'credit' && result.directionConfidence >= 0.5);
  return { wrongAmount, flagged, silent, date: judgeDate(result, made) };
}

/**
 * The date read against the one the class printed: 'right' in either order of
 * day and month where both could be a month, since which the device assumes is
 * not the receipt's doing; 'wrong' for any other date, or any date at all on a
 * receipt that prints none; 'none' where nothing was read. Undefined where the
 * class does not know its date.
 */
function judgeDate(result, made) {
  if (made.date === undefined) {
    return undefined;
  }
  if (!(result.dateConfidence > 0)) {
    return 'none';
  }
  const expected = made.date;
  const year = result.date.getFullYear();
  const month = result.date.getMonth() + 1;
  const day = result.date.getDate();
  const right =
    expected !== null &&
    year === expected.year &&
    ((month === expected.month && day === expected.day) ||
      (expected.day <= 12 && month === expected.day && day === expected.month));
  return right ? 'right' : 'wrong';
}

/**
 * The amount grade a model answering `answer` ends up with, as
 * NativeReceiptService grades it. `codeRule` is ADR 0189's: on a receipt that
 * prints a currency code and no sign, any total the parser read disputes a
 * model total that differs. `--grades-before-0189` leaves it off for the base
 * side, which shows what the rule itself moved.
 */
function modelGrade(result, answer, text, codeRule = true) {
  const demotedBesideCurrency =
    result.amountDemotion !== undefined && result.amountConfidence >= VERIFY_FIELD_THRESHOLD * DEMOTION_FACTOR;
  if (sameAmount(result.amount, answer)) {
    const pickedByRule = demotedBesideCurrency && result.amountDemotion !== 'tender';
    return pickedByRule ? result.amountConfidence : Math.max(result.amountConfidence, MODEL_READ_GRADE);
  }
  const codeOnly = codeRule && Boolean(result.currency) && !/\p{Sc}/u.test(text) && result.amount > 0;
  return result.amountConfidence >= VERIFY_FIELD_THRESHOLD || demotedBesideCurrency || codeOnly
    ? REVIEW_AMOUNT_CONFIDENCE
    : MODEL_READ_GRADE;
}

function emptyTally() {
  return {
    receipts: 0,
    silentBefore: 0,
    silentAfter: 0,
    newlySilent: 0,
    newlySilentWasRight: 0,
    rightNewlyFlagged: 0,
    rightToWrong: 0,
    wrongToRight: 0,
    modelWrongKeptBefore: 0,
    modelWrongKeptAfter: 0,
    modelRightFlaggedBefore: 0,
    modelRightFlaggedAfter: 0,
    typeNewlyAsked: 0,
    dated: 0,
    dateRightBefore: 0,
    dateRightAfter: 0,
    dateLost: 0,
    dateNewlyWrongOverBar: 0,
    examples: [],
  };
}

/** Reads one receipt on both versions and adds what it shows to the tally. */
function count(tally, made, text, before, after, baseCodeRule = true) {
  const was = before(text);
  const now = after(text);
  const judgedBefore = judge(was, made);
  const judgedAfter = judge(now, made);
  tally.receipts++;
  tally.silentBefore += Number(judgedBefore.silent);
  tally.silentAfter += Number(judgedAfter.silent);
  if (judgedAfter.silent && !judgedBefore.silent) {
    tally.newlySilent++;
    // Read right before, or wrong and flagged only: the second is a flag lost,
    // on a reading that was already wrong.
    tally.newlySilentWasRight += Number(!judgedBefore.wrongAmount);
    if (tally.examples.length < 3) {
      tally.examples.push(text.split('\n').join(' / '));
    }
  }
  if (!judgedBefore.wrongAmount && !judgedBefore.flagged && !judgedAfter.wrongAmount && judgedAfter.flagged) {
    tally.rightNewlyFlagged++;
  }
  tally.rightToWrong += Number(!judgedBefore.wrongAmount && judgedAfter.wrongAmount);
  tally.wrongToRight += Number(judgedBefore.wrongAmount && !judgedAfter.wrongAmount);
  tally.typeNewlyAsked += Number(
    made.kind === 'purchase' && was.directionConfidence === 0 && now.direction === 'debit' && now.directionConfidence > 0,
  );
  if (judgedAfter.date !== undefined) {
    const overBar = (judged, result) => judged.date === 'wrong' && result.dateConfidence >= VERIFY_FIELD_THRESHOLD;
    tally.dated++;
    tally.dateRightBefore += Number(judgedBefore.date === 'right');
    tally.dateRightAfter += Number(judgedAfter.date === 'right');
    tally.dateLost += Number(judgedBefore.date === 'right' && judgedAfter.date !== 'right');
    tally.dateNewlyWrongOverBar += Number(overBar(judgedAfter, now) && !overBar(judgedBefore, was));
  }
  for (const answer of made.figures) {
    const right = sameAmount(answer, made.amount);
    const gradeBefore = modelGrade(was, answer, text, baseCodeRule);
    const gradeAfter = modelGrade(now, answer, text);
    tally.modelWrongKeptBefore += Number(!right && gradeBefore >= VERIFY_FIELD_THRESHOLD);
    tally.modelWrongKeptAfter += Number(!right && gradeAfter >= VERIFY_FIELD_THRESHOLD);
    tally.modelRightFlaggedBefore += Number(right && gradeBefore < VERIFY_FIELD_THRESHOLD);
    tally.modelRightFlaggedAfter += Number(right && gradeAfter < VERIFY_FIELD_THRESHOLD);
  }
}

/** Every class and every seeded set, in both layouts, on both versions. */
function measure(before, after, { seed, perClass, sets, size, baseCodeRule = true }) {
  const rows = [];
  for (const [name, make] of Object.entries(CLASSES)) {
    const tallies = Object.fromEntries(LAYOUTS.map(layout => [layout, emptyTally()]));
    const random = mulberry32(seed);
    for (let index = 0; index < perClass; index++) {
      const made = make(writer(random));
      count(tallies.joined, made, made.text, before, after, baseCodeRule);
      count(tallies.split, made, split(made.text), before, after, baseCodeRule);
    }
    rows.push(...LAYOUTS.map(layout => ({ name, layout, ...tallies[layout] })));
  }
  for (let set = 1; set <= sets; set++) {
    const tallies = Object.fromEntries(LAYOUTS.map(layout => [layout, emptyTally()]));
    const random = mulberry32(seed + set);
    for (let index = 0; index < size; index++) {
      const made = mixed(random);
      count(tallies.joined, made, made.text, before, after, baseCodeRule);
      count(tallies.split, made, split(made.text), before, after, baseCodeRule);
    }
    rows.push(...LAYOUTS.map(layout => ({ name: `set ${set}`, layout, ...tallies[layout] })));
  }
  return rows;
}

function report(rows) {
  const columns = [
    ['class', row => row.name],
    ['layout', row => row.layout],
    ['receipts', row => row.receipts],
    ['silent', row => `${row.silentBefore} → ${row.silentAfter}`],
    ['newly silent', row => row.newlySilent],
    ['of them right before', row => row.newlySilentWasRight],
    ['right, newly flagged', row => row.rightNewlyFlagged],
    ['right → wrong', row => row.rightToWrong],
    ['wrong → right', row => row.wrongToRight],
    ['model: wrong kept', row => `${row.modelWrongKeptBefore} → ${row.modelWrongKeptAfter}`],
    ['model: right flagged', row => `${row.modelRightFlaggedBefore} → ${row.modelRightFlaggedAfter}`],
    ['type newly asked', row => row.typeNewlyAsked],
    ['date right', row => (row.dated > 0 ? `${row.dateRightBefore} → ${row.dateRightAfter}` : '')],
    ['date lost', row => (row.dated > 0 ? row.dateLost : '')],
    ['date newly wrong ≥ 0.7', row => (row.dated > 0 ? row.dateNewlyWrongOverBar : '')],
  ];
  const cells = [columns.map(([title]) => title), ...rows.map(row => columns.map(([, cell]) => String(cell(row))))];
  const widths = columns.map((_, index) => Math.max(...cells.map(line => line[index].length)));
  for (const line of cells) {
    console.log(line.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd());
  }
  for (const row of rows.filter(each => each.newlySilent > 0)) {
    for (const example of row.examples) {
      console.log(`newly silent, ${row.name} ${row.layout}: ${example}`);
    }
  }
}

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}

async function main() {
  const base = option('--base', 'HEAD');
  const dayFirst = process.argv.includes('--day-first');
  const settings = {
    seed: Number(option('--seed', '20261114')),
    perClass: Number(option('--per-class', '3000')),
    sets: Number(option('--sets', '6')),
    size: Number(option('--size', '40000')),
    baseCodeRule: !process.argv.includes('--grades-before-0189'),
  };
  const before = await loadParser(sourceAt(base), dayFirst);
  const after = await loadParser(sourceInTree(), dayFirst);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(
    `${SELF}: ${base} against the working tree, seed ${settings.seed}, ${zone}, ${dayFirst ? 'day' : 'month'} first`,
  );
  const rows = measure(before, after, settings);
  report(rows);
  const newlySilent = rows.reduce((total, row) => total + row.newlySilent, 0);
  if (newlySilent > 0) {
    console.error(`\n${newlySilent} receipt(s) newly read silently.`);
    process.exit(1);
  }
  console.log('\nNo receipt newly reads silently.');
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/** A parser small enough to read at a glance, for planting a regression. */
function fixtureSource(pick) {
  return `${DATE_IMPORT}
export function parseReceiptOcrText(text: string) {
  void localDateFromParts;
  const figures = [...text.matchAll(/\\d+(?:\\.\\d+)?/g)].map(match => Number(match[0]));
  const amount = ${pick};
  return { amount, amountConfidence: 0.8, direction: 'debit', directionConfidence: 0, date: new Date() };
}`;
}

async function selfTest() {
  const failed = [];
  const cases = [];
  const check = (name, ok, detail = '') => {
    cases.push(name);
    if (!ok) {
      failed.push(name);
      console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
    }
  };

  const texts = seed => {
    const random = mulberry32(seed);
    return Array.from({ length: 200 }, () => mixed(random).text).join('\n\n');
  };
  check('the same seed prints the same receipts', texts(7) === texts(7));
  check('another seed prints others', texts(7) !== texts(8));

  for (const [name, make] of Object.entries(CLASSES)) {
    const random = mulberry32(11);
    const made = Array.from({ length: 50 }, () => make(writer(random)));
    check(
      `class ${name} prints its own amount among its figures`,
      made.every(each => each.amount > 0 && each.figures.some(figure => sameAmount(figure, each.amount))),
    );
  }

  check(
    'a split line is its label and its last figure',
    split('Shop\nTotal $12.50\n2026-01-15 10:00') === 'Shop\nTotal\n$12.50\n2026-01-15 10:00',
  );

  const made = { amount: 12.5, kind: 'purchase', figures: [12.5, 15] };
  const reading = (amount, amountConfidence, extra = {}) => ({
    amount,
    amountConfidence,
    direction: 'debit',
    directionConfidence: 0,
    ...extra,
  });
  check('a wrong amount at the bar is silent', judge(reading(15, 0.8), made).silent);
  check('a wrong amount under the bar is not', !judge(reading(15, 0.6), made).silent);
  check('a right amount is not', !judge(reading(12.5, 0.8), made).silent);
  check(
    'a purchase read as a credit graded 0.5 is silent',
    judge(reading(12.5, 0.8, { direction: 'credit', directionConfidence: 0.5 }), made).silent,
  );
  check('a refund read as a purchase graded 0 is silent', judge(reading(12.5, 0.8), { ...made, kind: 'refund' }).silent);

  const on = (year, month, day, dateConfidence = 0.9) => ({
    ...reading(12.5, 0.8),
    date: new Date(year, month - 1, day),
    dateConfidence,
  });
  const printed = { ...made, date: { year: 2026, month: 3, day: 4 } };
  check('a class that knows no date judges none', judge(on(2026, 3, 4), made).date === undefined);
  check('the printed date is right', judge(on(2026, 3, 4), printed).date === 'right');
  check('and right in the other order where both parts could be a month', judge(on(2026, 4, 3), printed).date === 'right');
  check('another date is wrong', judge(on(2026, 3, 5), printed).date === 'wrong');
  check('no date read is none', judge(on(2026, 3, 4, 0), printed).date === 'none');
  check('any date is wrong on a receipt that prints none', judge(on(2026, 3, 4), { ...made, date: null }).date === 'wrong');

  const asked = emptyTally();
  count(asked, made, 'Shop', () => reading(12.5, 0.8), () => reading(12.5, 0.8, { directionConfidence: 0.3 }));
  check('a purchase whose type is newly asked about is counted', asked.typeNewlyAsked === 1 && asked.dated === 0);
  const lost = emptyTally();
  count(lost, printed, 'Shop', () => on(2026, 3, 4), () => on(2025, 1, 1));
  check(
    'a date read right and then wrong at the bar is counted both ways',
    lost.dated === 1 && lost.dateRightBefore === 1 && lost.dateRightAfter === 0 && lost.dateLost === 1 && lost.dateNewlyWrongOverBar === 1,
    JSON.stringify(lost),
  );

  check('a model agreeing with a plain reading is lifted', modelGrade(reading(12.5, 0.5), 12.5, 'Shop') === 0.8);
  check(
    'a model agreeing with a rule pick keeps the parser grade',
    modelGrade(reading(12.5, 0.6, { amountDemotion: 'aside' }), 12.5, 'Shop') === 0.6,
  );
  check(
    'a model agreeing with a tendered pick is lifted',
    modelGrade(reading(12.5, 0.6, { amountDemotion: 'tender' }), 12.5, 'Shop') === 0.8,
  );
  check('a model disputing a confident reading is flagged', modelGrade(reading(12.5, 0.8), 15, 'Shop') === 0.5);
  check(
    'a model disputing a rule pick is flagged',
    modelGrade(reading(12.5, 0.6, { amountDemotion: 'count' }), 15, 'Shop') === 0.5,
  );
  check('a model disputing a weak reading is lifted', modelGrade(reading(12.5, 0.3), 15, 'Shop\n12.50\n15.00') === 0.8);
  const coded = reading(12.5, 0.5, { currency: 'EUR' });
  check('but disputed on a receipt that prints a code and no sign', modelGrade(coded, 15, 'Shop\n14:32 EUR\n12,50') === 0.5);
  check('and lifted there where the receipt prints a sign', modelGrade(coded, 15, 'Shop\n€ 12,50') === 0.8);
  check('or where the rule is left off', modelGrade(coded, 15, 'Shop\n14:32 EUR\n12,50', false) === 0.8);
  check('an agreement on such a receipt is lifted', modelGrade(coded, 12.5, 'Shop\n14:32 EUR\n12,50') === 0.8);

  const largest = await loadParser(fixtureSource('Math.max(0, ...figures)'), false);
  const first = await loadParser(fixtureSource('figures[0] ?? 0'), false);
  const settings = { seed: 3, perClass: 40, sets: 1, size: 200 };
  const same = measure(largest, largest, settings);
  check(
    'a version against itself moves nothing',
    same.every(row => row.newlySilent === 0 && row.rightToWrong === 0 && row.silentBefore === row.silentAfter),
  );
  const row = rows => rows.find(each => each.name === 'totalAboveParts' && each.layout === 'joined');
  const planted = row(measure(largest, first, settings));
  check('a planted regression is counted as newly silent', planted.newlySilent > 0, JSON.stringify(planted));
  check('all of them read right before', planted.newlySilentWasRight === planted.newlySilent);
  check('and as right readings gone wrong', planted.rightToWrong === planted.newlySilent);
  const repaired = row(measure(first, largest, settings));
  check(
    'and its repair as wrong readings gone right',
    repaired.wrongToRight === planted.rightToWrong && repaired.newlySilent === 0,
  );

  const inTree = await loadParser(sourceInTree(), false);
  const atHead = await loadParser(sourceAt('HEAD'), false);
  for (const [name, parse] of [
    ['the working tree', inTree],
    ['HEAD', atHead],
  ]) {
    const result = parse('Shop\n2026-01-15\nTotal $12.50');
    check(`the parser loads from ${name}`, result.amount === 12.5 && result.amountConfidence === 0.8, JSON.stringify(result));
    check(
      `the clock is held for ${name}`,
      parse('Shop\nTotal $1.00').date.getTime() === new Date(2026, 9, 30, 12).getTime(),
    );
  }
  const ambiguous = 'Shop\n03/04/2026\nTotal $1.00';
  const dayFirst = await loadParser(sourceInTree(), true);
  check('the month comes first by default', inTree(ambiguous).date.getMonth() === 2);
  check('and the day where asked', dayFirst(ambiguous).date.getMonth() === 3);

  let refused = false;
  try {
    await loadParser('export const nothing = 1;', false);
  } catch {
    refused = true;
  }
  check('a parser whose import moved is refused, not read wrongly', refused);

  if (failed.length > 0) {
    console.error(`\n${failed.length} self-test failure(s) — the harness itself is broken.`);
    process.exit(1);
  }
  console.log(`measure-receipt-parser self-test: ${cases.length} passed`);
}

if (process.argv.includes('--self-test')) {
  await selfTest();
} else {
  await main();
}
