/**
 * Rules for reading what a model reports about a receipt.
 *
 * All three provider services parse the same JSON shape, so the rules for
 * getting a value out of it live here rather than in three private copies —
 * that drift is what ADR 0005 was written about. The prompts are shared; the
 * parsing of their answers should be too.
 */
import { isCurrencyCode } from '../../models';
import type { FieldConfidence, TransactionLocation } from '../../models';

/**
 * A confidence the model reported, clamped to 0–1.
 *
 * Undefined means the model reported nothing usable, which is distinct from
 * reporting 0 — "I could not read this at all" is a real answer and must
 * survive, so this cannot be written as a truthiness check.
 */
export function readConfidence(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.min(1, Math.max(0, parsed));
}

/**
 * Every ISO 4217 code the runtime knows, which is the whole table rather than
 * a list maintained here. Deriving it is the point: a receipt in a currency
 * nobody thought to add still reads correctly, while a model answering "Won"
 * or "₩" still does not.
 */
const ISO_CURRENCY_CODES: ReadonlySet<string> = (() => {
  try {
    return new Set(Intl.supportedValuesOf('currency'));
  } catch {
    // Older runtimes without supportedValuesOf: fall back to shape alone,
    // which is weaker but still rejects prose and symbols.
    return new Set<string>();
  }
})();

/**
 * The currency code a model reported, or '' when it reported nothing usable.
 *
 * Empty rather than a guess on purpose. Every caller already knows a better
 * answer than the model does — the account's own base currency — and the
 * hardcoded defaults this replaces did not even agree with each other: the
 * same extraction method fell back to CNY on one branch and JPY on the next,
 * with USD everywhere else, so one receipt imported differently depending on
 * which path read it.
 *
 * Stricter than `isCurrencyCode`, and deliberately so: that one answers "can
 * the app represent this", which stays permissive so a code the rates endpoint
 * knows is never refused. This one answers "did the model read a real code off
 * a receipt", where a plausible-looking invention is the actual failure mode —
 * "WON" is ISO-shaped and is not a currency.
 */
export function readCurrencyCode(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const code = value.trim().toUpperCase();
  if (!isCurrencyCode(code)) {
    return '';
  }
  if (ISO_CURRENCY_CODES.size === 0) {
    return code;
  }
  return ISO_CURRENCY_CODES.has(code) ? code : '';
}

/** The printed grand total a model reported, or undefined when it reported nothing usable. */
export function readReceiptTotal(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return undefined;
  return Math.abs(parsed);
}

/**
 * The per-field confidences the receipt prompts ask for. Undefined when the
 * model reported neither, so a source that cannot know (the regex parser, a
 * CSV row) stays distinguishable from one that read the fields clearly.
 */
export function readFieldConfidence(parsed: {
  amountConfidence?: unknown;
  dateConfidence?: unknown;
}): FieldConfidence | undefined {
  const amount = readConfidence(parsed.amountConfidence);
  const date = readConfidence(parsed.dateConfidence);
  if (amount === undefined && date === undefined) {
    return undefined;
  }
  return {
    ...(amount !== undefined ? { amount } : {}),
    ...(date !== undefined ? { date } : {}),
  };
}

/** Longest address kept; a model echoing the whole receipt body here is not reporting an address. */
const MAX_PRINTED_LOCATION_LENGTH = 120;

/**
 * The place a model read off the receipt, or undefined when it read none.
 *
 * Undefined rather than '' because the row slot means "nobody looked" when
 * absent (ADR 0059). A value that is just the merchant name is dropped: the
 * prompt forbids inferring a place from the name, and a model that did has
 * not said where the receipt was issued.
 */
export function readPrintedLocation(value: unknown, merchant?: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name || name.length > MAX_PRINTED_LOCATION_LENGTH) return undefined;
  const printedBy =
    typeof merchant === 'string' ? merchant.replace(/\s+/g, ' ').trim().toLowerCase() : '';
  if (printedBy && printedBy === name.toLowerCase()) {
    return undefined;
  }
  return name;
}

/** The row slot for a printed location, or nothing at all when none was read. */
export function printedLocationSlot(name: string | undefined): { location?: TransactionLocation } {
  return name ? { location: { name } } : {};
}
