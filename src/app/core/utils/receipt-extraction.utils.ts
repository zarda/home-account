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

/**
 * Every region the runtime can name, asked with `fallback: 'none'` so a
 * well-formed code it does not know answers undefined rather than echoing
 * itself — the default fallback would make "AA" look like a country called AA.
 */
const REGION_NAMES: Intl.DisplayNames | null = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  } catch {
    // Older runtimes without DisplayNames: shape alone, which still rejects
    // prose, alpha-3 codes and numbers.
    return null;
  }
})();

/**
 * Folds a CLDR-only spelling to the ISO 3166-1 code it stands for — UK to GB,
 * and the whole deprecated-territory alias table CLDR maintains (SU, AN, ZR,
 * YU, CS, DD and the rest of it) to whatever replaced each one — using
 * Intl.Locale's own canonicalization rather than a maintained list, in
 * keeping with ADR 0008. UK is the one that matters: it is a plausible answer
 * for a British receipt, and without this it would pass readCountryCode
 * unchanged while quietly losing the GBP suggestion GB carries downstream.
 * Falls back to the code unchanged on a runtime without Intl.Locale, or on
 * any input the constructor refuses.
 */
function canonicalizeRegion(code: string): string {
  try {
    return new Intl.Locale('und-' + code).region ?? code;
  } catch {
    return code;
  }
}

/**
 * The ISO 3166-1 alpha-2 country a model reported, or '' when it reported
 * nothing usable.
 *
 * Empty rather than a guess, like readCurrencyCode: a country the model
 * inferred badly is worse than none, because everything downstream offers a
 * currency from it. The prompt carries no list of codes (ADR 0008), so the
 * answer is checked against the runtime's own region table on the way back.
 * ZZ is refused by name: CLDR calls it "Unknown Region", which is an honest
 * answer and not a country.
 *
 * A handful of CLDR-only macroregions (EU, UN, QO, the pseudo-locales, the
 * "exceptionally reserved" codes such as AC or IC) pass this check even
 * though ISO 3166-1 does not name them as countries: the runtime has a table
 * of what it can name, not a table of which of those names are countries,
 * and there is no rule to derive that distinction from — only a maintained
 * list would separate them, which is the thing ADR 0008 asks this file not to
 * keep. This function serves two consumers, and both tolerate it. The
 * currency ladder is the harmless one: none of them is a COUNTRY_CURRENCY
 * key, so it simply finds nothing for them, the same fallback a code this
 * function cannot place already gets. The other is `location.country` on a
 * transaction (`printedLocationSlot`), which only ever stores this value
 * alongside a printed address the same answer also produced — a receipt
 * claiming to be issued from "the European Union" rather than a place is not
 * a case the address next to it is trustworthy for either, so a macroregion
 * landing there is no worse than the free-text place name a model can put in
 * that same slot unchecked. No reader exists yet for either consumer —
 * `location.country` is write-only today, and nothing displays, exports or
 * aggregates it. The read that would eventually face this tradeoff is a
 * country rollup, the reason `transaction.model.ts` gives for keeping the
 * field at all, and it would see one of these macroregions rather than a
 * country for exactly the receipts this paragraph describes.
 */
export function readCountryCode(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const shape = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(shape)) {
    return '';
  }
  const code = canonicalizeRegion(shape);
  if (code === 'ZZ') {
    return '';
  }
  if (!REGION_NAMES) {
    return code;
  }
  let name: string | undefined;
  try {
    name = REGION_NAMES.of(code);
  } catch {
    return '';
  }
  return name && name !== code ? code : '';
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

/**
 * The row slot for a printed location, or nothing at all when none was read.
 * The country rides inside it only when there is an address to hang it on.
 */
export function printedLocationSlot(
  name: string | undefined,
  country?: string
): { location?: TransactionLocation } {
  if (!name) return {};
  return { location: { name, ...(country ? { country } : {}) } };
}
