import { CategoryTotal, Transaction } from '../../models';
import { dateOf, monthKey } from './transaction-date.utils';

/**
 * Aggregation shared by the reports tabs and the spending-pattern detectors.
 *
 * Every one of these was previously inlined in several components at once — the
 * sum-by-type reduce in five places, the group-by-category map in seven, the
 * `yyyy-MM` bucket in six. Detectors need all of them, so they live here once.
 *
 * Amount conversion is injected (`toBase`) exactly as in spending-insight.utils,
 * so callers keep control of currency handling.
 *
 * Determinism notes, because snapshot documents are compared byte for byte:
 * - every sort ends in an explicit tiebreaker, since Firestore returns rows in
 *   `date desc` order and ties are common;
 * - money and ratios are rounded at the output boundary, or two runs over
 *   identical data differ in the fifteenth decimal.
 */

export type ToBase = (transaction: Transaction) => number;

export interface TypeTotals {
  income: number;
  expense: number;
  /** income - expense. */
  balance: number;
  /** Every transaction considered, both types. */
  count: number;
}

export interface CategoryTotalWithCount extends CategoryTotal {
  count: number;
}

/** One category's total on one side of the ledger, and the rows behind it. */
export interface CategoryTypeTotal {
  categoryId: string;
  type: 'income' | 'expense';
  total: number;
  count: number;
}

/** Expense total for one ISO 3166-1 alpha-2 country, and the rows behind it. */
export interface CountryTotal {
  country: string;
  total: number;
  count: number;
}

/**
 * Expense totals per country, with the coverage figure that says how much of
 * the period the ranked list actually speaks for.
 */
export interface CountryBreakdown {
  countries: CountryTotal[];
  /** Expense rows carrying a country. */
  placed: number;
  /** Expense rows in the period, placed or not. */
  expenses: number;
}

/** Per-month totals for one category, parallel to a `months` array. */
export interface CategorySeries {
  categoryId: string;
  values: number[];
}

/**
 * Per-month, per-category totals over a fixed month list.
 *
 * Deliberately flat arrays of `{categoryId, values}` rather than a nested
 * `number[][]`: Firestore forbids nested arrays, and this shape is what gets
 * persisted into an insight snapshot.
 */
export interface MonthlyCategorySeries {
  /** Contiguous ascending `yyyy-MM`, oldest first. */
  months: string[];
  totalsByCategory: CategorySeries[];
  countsByCategory: CategorySeries[];
  /** Sum of every category's totals across the window. */
  windowTotal: number;
}

/**
 * Order two ids by UTF-16 code unit, as a deterministic sort tiebreaker.
 *
 * Deliberately not `localeCompare`, whose collation depends on the runtime's
 * ICU data and which ignores punctuation in some locales — so `food_x` and
 * `foodx` could order differently on two devices, and a regenerated snapshot
 * would stop matching the one it replaced.
 */
export function compareIds(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/** Round to cents. Stability matters more here than accounting exactness. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundRatio(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Last line of defence before a value reaches Firestore, which rejects both
 * NaN and Infinity outright and would fail the whole document write.
 */
export function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** Income and expense totals in base currency, plus the balance. */
export function sumByType(transactions: Transaction[], toBase: ToBase): TypeTotals {
  let income = 0;
  let expense = 0;
  for (const transaction of transactions) {
    if (transaction.type === 'income') {
      income += toBase(transaction);
    } else {
      expense += toBase(transaction);
    }
  }
  return {
    income: roundMoney(income),
    expense: roundMoney(expense),
    balance: roundMoney(income - expense),
    count: transactions.length,
  };
}

/**
 * Expense totals per category, largest first, tie-broken by category id.
 *
 * Named for what it does: it filters to expenses internally, which is what
 * every existing caller wants but is invisible at a call site reading
 * `groupByCategory(transactions, toBase)`.
 */
export function groupExpensesByCategory(
  transactions: Transaction[],
  toBase: ToBase,
): CategoryTotal[] {
  return groupExpensesByCategoryWithCounts(transactions, toBase)
    .map(({ categoryId, total }) => ({ categoryId, total }));
}

/** As groupExpensesByCategory, plus the transaction count behind each total. */
export function groupExpensesByCategoryWithCounts(
  transactions: Transaction[],
  toBase: ToBase,
): CategoryTotalWithCount[] {
  const totals = new Map<string, { total: number; count: number }>();
  for (const transaction of transactions) {
    if (transaction.type !== 'expense') {
      continue;
    }
    const entry = totals.get(transaction.categoryId) ?? { total: 0, count: 0 };
    entry.total += toBase(transaction);
    entry.count += 1;
    totals.set(transaction.categoryId, entry);
  }

  return [...totals.entries()]
    .map(([categoryId, entry]) => ({
      categoryId,
      total: roundMoney(entry.total),
      count: entry.count,
    }))
    .sort((a, b) => b.total - a.total || compareIds(a.categoryId, b.categoryId));
}

/**
 * Totals per category *and* side of the ledger — the one grouping here that
 * keeps income. Named for filtering nothing: every neighbouring
 * `groupExpensesBy*` drops income silently, and a summary that inherited that
 * would report a salary category as simply absent.
 *
 * A category carrying both an expense and an income yields two rows rather
 * than a netted one. `other` is a real category on both sides, and netting it
 * would make a month of equal flows read as no activity at all.
 *
 * Expenses come first as a block, then income, each side largest-first — the
 * order must not reshuffle on the month income happens to outweigh spending.
 */
export function groupByCategoryAndType(
  transactions: Transaction[],
  toBase: ToBase,
): CategoryTypeTotal[] {
  const totals = new Map<string, CategoryTypeTotal>();

  for (const transaction of transactions) {
    const key = `${transaction.type}|${transaction.categoryId}`;
    const entry = totals.get(key) ?? {
      categoryId: transaction.categoryId,
      type: transaction.type,
      total: 0,
      count: 0,
    };
    entry.total += toBase(transaction);
    entry.count += 1;
    totals.set(key, entry);
  }

  return [...totals.values()]
    .map(entry => ({ ...entry, total: roundMoney(entry.total) }))
    .sort((a, b) =>
      sideRank(a) - sideRank(b)
      || b.total - a.total
      || compareIds(a.categoryId, b.categoryId));
}

function sideRank(row: CategoryTypeTotal): number {
  return row.type === 'expense' ? 0 : 1;
}

/**
 * Expense totals per country, largest first, tie-broken by country code.
 *
 * Rows with no country are counted but not ranked. A country reaches a
 * transaction only from a receipt that named one or a coordinate the user
 * attached, and neither happens retroactively — so on any account with
 * history most of the money has no country at all. Ranking an "unknown"
 * bucket would put it first forever and make the card a reminder rather than
 * a readback; `placed` against `expenses` says the same thing honestly, in
 * one line the card can show.
 *
 * The country is not validated here. `readCountryCode` and the rules both
 * pin it to two letters upstream, and CLDR names some macroregions (`EU`,
 * `QO`) that are not countries — a row for one of those is a coarser answer,
 * which is what it is, not a broken one.
 */
export function groupExpensesByCountry(
  transactions: Transaction[],
  toBase: ToBase,
): CountryBreakdown {
  const totals = new Map<string, { total: number; count: number }>();
  let expenses = 0;
  let placed = 0;

  for (const transaction of transactions) {
    if (transaction.type !== 'expense') {
      continue;
    }
    expenses += 1;
    const country = transaction.location?.country?.trim();
    if (!country) {
      continue;
    }
    placed += 1;
    const entry = totals.get(country) ?? { total: 0, count: 0 };
    entry.total += toBase(transaction);
    entry.count += 1;
    totals.set(country, entry);
  }

  const countries = [...totals.entries()]
    .map(([country, entry]) => ({
      country,
      total: roundMoney(entry.total),
      count: entry.count,
    }))
    .sort((a, b) => b.total - a.total || compareIds(a.country, b.country));

  return { countries, placed, expenses };
}

/**
 * Bucket into the given months, zero-filling any month with no activity.
 *
 * Zero-filling is the point: a category with spending in the first and last
 * month of a window must read as *falling*, not steady, and it can only do that
 * if the empty months in between are present as zeros rather than missing.
 *
 * Does not filter by type — pass the transactions you mean.
 */
export function bucketByMonth(
  transactions: Transaction[],
  toBase: ToBase,
  months: string[],
): { months: string[]; totals: number[]; counts: number[] } {
  const index = new Map(months.map((key, position) => [key, position]));
  const totals = new Array<number>(months.length).fill(0);
  const counts = new Array<number>(months.length).fill(0);

  for (const transaction of transactions) {
    const position = index.get(monthKey(dateOf(transaction)));
    if (position === undefined) {
      continue;
    }
    totals[position] += toBase(transaction);
    counts[position] += 1;
  }

  return { months: [...months], totals: totals.map(roundMoney), counts };
}

/**
 * Per-month, per-category series over the given months. Category order is
 * sorted by id so two runs over identical data produce identical arrays.
 *
 * Does not filter by type — pass the transactions you mean.
 */
export function bucketByMonthAndCategory(
  transactions: Transaction[],
  toBase: ToBase,
  months: string[],
): MonthlyCategorySeries {
  const index = new Map(months.map((key, position) => [key, position]));
  const totals = new Map<string, number[]>();
  const counts = new Map<string, number[]>();
  let windowTotal = 0;

  for (const transaction of transactions) {
    const position = index.get(monthKey(dateOf(transaction)));
    if (position === undefined) {
      continue;
    }
    const { categoryId } = transaction;
    if (!totals.has(categoryId)) {
      totals.set(categoryId, new Array<number>(months.length).fill(0));
      counts.set(categoryId, new Array<number>(months.length).fill(0));
    }
    const value = toBase(transaction);
    totals.get(categoryId)![position] += value;
    counts.get(categoryId)![position] += 1;
    windowTotal += value;
  }

  const categoryIds = [...totals.keys()].sort(compareIds);
  return {
    months: [...months],
    totalsByCategory: categoryIds.map(categoryId => ({
      categoryId,
      values: totals.get(categoryId)!.map(roundMoney),
    })),
    countsByCategory: categoryIds.map(categoryId => ({
      categoryId,
      values: counts.get(categoryId)!,
    })),
    windowTotal: roundMoney(windowTotal),
  };
}

/**
 * Fractional change from `previous` to `current`, or null when there is no
 * meaningful base to compare against. Null rather than Infinity because a
 * non-finite number cannot be written to Firestore.
 */
export function percentDelta(current: number, previous: number): number | null {
  if (previous <= 0) {
    return null;
  }
  return roundRatio((current - previous) / previous);
}

/** Median of the values. Zero for an empty list. Does not mutate the input. */
export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Nearest-rank percentile: `sorted[ceil(p * n) - 1]`, floored at index 0.
 *
 * Spelled out because the detectors' thresholds are asserted against it at
 * small n — for n = 4 and p = 0.25 this is the smallest value, not an
 * interpolation between the first two. Zero for an empty list.
 */
export function percentileNearestRank(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

/**
 * 32-bit FNV-1a as 8 hex characters. Non-cryptographic by design: it only has
 * to change when the input changes, which is all a content fingerprint needs.
 */
export function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
