#!/usr/bin/env node
/**
 * Reads the same generated receipts on two versions of the device's text
 * parser and counts what moved (#527, #528, #530; ADR 0188).
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
 * device outside the US does. The zone is the process's own, so set `TZ`. The
 * clock is held at noon on 30 October 2026, the battery's.
 *
 * Both versions are loaded from source text. The parser's one import is a
 * date helper whose own module reaches for the Firestore SDK, so the import
 * line is replaced by the helper's five lines and the result is transpiled
 * with the repository's own TypeScript.
 *
 * The exit code is 1 where a receipt newly reads silently in any class,
 * layout or set, and 0 otherwise. Right readings newly flagged, and right
 * readings that became wrong and flagged, are counted and printed, never
 * failed: they are costs for a record to state.
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
  { code: 'USD', decimals: 2, print: text => `$${text}`, spaced: text => `$ ${text}`, mark: '.', group: ',' },
  { code: 'EUR', decimals: 2, print: text => `${text} €`, spaced: text => `€ ${text}`, mark: ',', group: '.' },
  { code: 'JPY', decimals: 0, print: text => `¥${text}`, spaced: text => `¥ ${text}`, mark: '.', group: ',' },
  { code: 'KRW', decimals: 0, print: text => `₩${text}`, spaced: text => `₩ ${text}`, mark: '.', group: ',' },
];

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
  w => `${String(w.int(0, 23)).padStart(2, '0')}:${String(w.int(0, 59)).padStart(2, '0')}`,
  w => `2026-${String(w.int(1, 10)).padStart(2, '0')}-${String(w.int(1, 28)).padStart(2, '0')}`,
  w => `${String(w.int(1, 12)).padStart(2, '0')}/${String(w.int(1, 28)).padStart(2, '0')}/${w.of(['25', '26', '2026'])}`,
  w => `VISA ****${w.int(1000, 9999)}`,
  w => `TEL 03-${w.int(1000, 9999)}-${w.int(1000, 9999)}`,
  w => `No. ${w.int(100000, 999999)}`,
];

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
    lines.splice(w.int(1, lines.length), 0, w.of(NOISE)(w));
  }
  const text = lines.join('\n');
  return { ...made, text: w.chance(0.1) ? text.replace(/\s?[$€¥₩]\s?/gu, ' ').replace(/ +/g, ' ') : text };
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
  return { wrongAmount, flagged, silent };
}

/** The amount grade a model answering `answer` ends up with, as NativeReceiptService grades it. */
function modelGrade(result, answer) {
  const demotedBesideCurrency =
    result.amountDemotion !== undefined && result.amountConfidence >= VERIFY_FIELD_THRESHOLD * DEMOTION_FACTOR;
  if (sameAmount(result.amount, answer)) {
    const pickedByRule = demotedBesideCurrency && result.amountDemotion !== 'tender';
    return pickedByRule ? result.amountConfidence : Math.max(result.amountConfidence, MODEL_READ_GRADE);
  }
  return result.amountConfidence >= VERIFY_FIELD_THRESHOLD || demotedBesideCurrency
    ? REVIEW_AMOUNT_CONFIDENCE
    : MODEL_READ_GRADE;
}

function emptyTally() {
  return {
    receipts: 0,
    silentBefore: 0,
    silentAfter: 0,
    newlySilent: 0,
    rightNewlyFlagged: 0,
    rightToWrong: 0,
    wrongToRight: 0,
    modelWrongKeptBefore: 0,
    modelWrongKeptAfter: 0,
    modelRightFlaggedBefore: 0,
    modelRightFlaggedAfter: 0,
    examples: [],
  };
}

/** Reads one receipt on both versions and adds what it shows to the tally. */
function count(tally, made, text, before, after) {
  const was = before(text);
  const now = after(text);
  const judgedBefore = judge(was, made);
  const judgedAfter = judge(now, made);
  tally.receipts++;
  tally.silentBefore += Number(judgedBefore.silent);
  tally.silentAfter += Number(judgedAfter.silent);
  if (judgedAfter.silent && !judgedBefore.silent) {
    tally.newlySilent++;
    if (tally.examples.length < 3) {
      tally.examples.push(text.split('\n').join(' / '));
    }
  }
  if (!judgedBefore.wrongAmount && !judgedBefore.flagged && !judgedAfter.wrongAmount && judgedAfter.flagged) {
    tally.rightNewlyFlagged++;
  }
  tally.rightToWrong += Number(!judgedBefore.wrongAmount && judgedAfter.wrongAmount);
  tally.wrongToRight += Number(judgedBefore.wrongAmount && !judgedAfter.wrongAmount);
  for (const answer of made.figures) {
    const right = sameAmount(answer, made.amount);
    const gradeBefore = modelGrade(was, answer);
    const gradeAfter = modelGrade(now, answer);
    tally.modelWrongKeptBefore += Number(!right && gradeBefore >= VERIFY_FIELD_THRESHOLD);
    tally.modelWrongKeptAfter += Number(!right && gradeAfter >= VERIFY_FIELD_THRESHOLD);
    tally.modelRightFlaggedBefore += Number(right && gradeBefore < VERIFY_FIELD_THRESHOLD);
    tally.modelRightFlaggedAfter += Number(right && gradeAfter < VERIFY_FIELD_THRESHOLD);
  }
}

/** Every class and every seeded set, in both layouts, on both versions. */
function measure(before, after, { seed, perClass, sets, size }) {
  const rows = [];
  for (const [name, make] of Object.entries(CLASSES)) {
    const tallies = Object.fromEntries(LAYOUTS.map(layout => [layout, emptyTally()]));
    const random = mulberry32(seed);
    for (let index = 0; index < perClass; index++) {
      const made = make(writer(random));
      count(tallies.joined, made, made.text, before, after);
      count(tallies.split, made, split(made.text), before, after);
    }
    rows.push(...LAYOUTS.map(layout => ({ name, layout, ...tallies[layout] })));
  }
  for (let set = 1; set <= sets; set++) {
    const tallies = Object.fromEntries(LAYOUTS.map(layout => [layout, emptyTally()]));
    const random = mulberry32(seed + set);
    for (let index = 0; index < size; index++) {
      const made = mixed(random);
      count(tallies.joined, made, made.text, before, after);
      count(tallies.split, made, split(made.text), before, after);
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
    ['right, newly flagged', row => row.rightNewlyFlagged],
    ['right → wrong', row => row.rightToWrong],
    ['wrong → right', row => row.wrongToRight],
    ['model: wrong kept', row => `${row.modelWrongKeptBefore} → ${row.modelWrongKeptAfter}`],
    ['model: right flagged', row => `${row.modelRightFlaggedBefore} → ${row.modelRightFlaggedAfter}`],
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

  check('a model agreeing with a plain reading is lifted', modelGrade(reading(12.5, 0.5), 12.5) === 0.8);
  check(
    'a model agreeing with a rule pick keeps the parser grade',
    modelGrade(reading(12.5, 0.6, { amountDemotion: 'aside' }), 12.5) === 0.6,
  );
  check(
    'a model agreeing with a tendered pick is lifted',
    modelGrade(reading(12.5, 0.6, { amountDemotion: 'tender' }), 12.5) === 0.8,
  );
  check('a model disputing a confident reading is flagged', modelGrade(reading(12.5, 0.8), 15) === 0.5);
  check(
    'a model disputing a rule pick is flagged',
    modelGrade(reading(12.5, 0.6, { amountDemotion: 'count' }), 15) === 0.5,
  );
  check('a model disputing a weak reading is lifted', modelGrade(reading(12.5, 0.3), 15) === 0.8);

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
