import { BudgetPeriod, CreateTransactionDTO, TransactionLocation, VERIFY_FIELD_THRESHOLD } from '../../models';
import { FALLBACK_CATEGORY_ID } from './categorization.utils';
import { parseDateInput } from './transaction-date.utils';

/**
 * The one row shape an import door hands over to become a transaction.
 *
 * Every field is optional except amount and date because absence is meaning:
 * a bank CSV carries none of the optionals, a receipt may carry two, and a
 * missing slot must keep meaning "nobody looked" all the way to the write.
 */
export interface ImportRowFields {
  type?: 'income' | 'expense';
  amount: number;
  currency?: string;
  categoryId?: string;
  description?: string;
  date: Date;
  note?: string;
  tags?: string[];
  location?: TransactionLocation;
  isRecurring?: boolean;
  recurringId?: string;
  period?: BudgetPeriod;
  /**
   * The country the reader concluded the receipt was issued in, when no
   * printed address gave the location a name.
   *
   * The one review-step mark permitted to become a document field. Every
   * other mark — `currencyFellBack`, the suggestions — stops at the review
   * card by design, because it describes how confident the app is rather
   * than what happened. A country is a fact about the receipt, and 0064
   * withheld it only because nothing rendered it; 0068 gives it a reader and
   * lets it through. `locationSlot` decides whether it lands.
   */
  receiptCountry?: string;
}

/**
 * The currency an import row is shown in, and whether anyone read it.
 *
 * Every door used to write `row.currency || baseCurrency` and lose the
 * difference. The flag is what lets the review step mark a currency nobody
 * read — the same distinction `ProcessedTransaction.currencyFellBack` draws
 * for the form's scan — and it never reaches the mapper below, which names
 * its fields.
 */
export function resolveImportCurrency(
  read: string | undefined,
  baseCurrency: string
): { currency: string; currencyFellBack?: true } {
  return read ? { currency: read } : { currency: baseCurrency, currencyFellBack: true };
}

/** What `resolveImportDate` decided: the date to use, and whether it's a real reading. */
export interface ResolvedImportDate {
  date: Date;
  /** 0 when the raw value was unreadable; otherwise the reader's own grade, when one exists. */
  dateConfidence?: number;
  /** Present when `date` is "now" rather than something read off the source. */
  dateAssumed?: true;
  /**
   * Present only when `dateAssumed` is set because the parsed value itself
   * was beyond belief, not because it was unreadable.
   */
  dateImplausible?: true;
}

/** One day of grace before a parsed date counts as future — same allowance `receipt-text-parser`'s own future-date guard uses. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The one place an import row's date is read and, when it can't be trusted,
 * replaced with `now` so the transaction surfaces at the top of today's list
 * rather than being buried under a misread day. "Can't be trusted" covers
 * three things: a value nothing can parse, one the reader graded below the
 * bar, and — for graded rows only — one that parsed cleanly but lands more
 * than a day ahead or more than ten calendar years back, because a confident
 * misread buries the transaction exactly as well as an unconfident one.
 *
 * `undefined` confidence never substitutes — not here and not in the
 * threshold check below: CSV and JSON rows have no reader to grade them, the
 * same rationale `needsVerification` uses for the preview card. An ungated
 * plausibility window would redate every row of a years-old CSV backup to
 * today on re-import. The threshold check is strict `<`, so a reading graded
 * exactly `VERIFY_FIELD_THRESHOLD` is kept. "Now" means `now` itself, never
 * `startOfDay(now)` — a parsed date lands at local midnight, so only the
 * actual instant sorts strictly above every other row dated today in a
 * newest-first list. `toCreateTransactionDTO` stays untouched (ADR 0059):
 * callers run their row through this first and hand it an already-resolved
 * date.
 */
export function resolveImportDate(
  raw: unknown, confidence?: number, now: Date = new Date()
): ResolvedImportDate {
  const parsed = parseDateInput(raw);
  if (parsed === null) return { date: now, dateConfidence: 0, dateAssumed: true };
  const tenYearsAgo = new Date(now);
  tenYearsAgo.setFullYear(now.getFullYear() - 10);
  if (
    confidence !== undefined &&
    (parsed.getTime() > now.getTime() + DAY_MS || parsed.getTime() < tenYearsAgo.getTime())
  ) {
    return { date: now, dateConfidence: confidence, dateAssumed: true, dateImplausible: true };
  }
  if (confidence !== undefined && confidence < VERIFY_FIELD_THRESHOLD) {
    return { date: now, dateConfidence: confidence, dateAssumed: true };
  }
  return { date: parsed, ...(confidence !== undefined ? { dateConfidence: confidence } : {}) };
}

/**
 * The one builder that decides whether a location is worth writing, and what
 * shape it takes.
 *
 * A location map has to say something: at least one of a name or a country.
 * `{}` and `{ name: '' }` both pass the shape check a truthy spread performs
 * and mean nothing once stored — that hole is named in the comment below and
 * was never closed until this became the single place the decision is made.
 *
 * A country with no name is a real answer, not a degraded one: a receipt can
 * reveal where it was issued through a tax number, a phone format or its own
 * script while printing no address at all (0068, amending 0064).
 */
export function locationSlot(
  name?: string | null,
  country?: string | null,
  coords?: { lat?: number; lng?: number } | null
): { location?: TransactionLocation } {
  const trimmed = name?.trim();
  const code = country?.trim();
  if (!trimmed && !code) return {};
  return {
    location: {
      ...(trimmed ? { name: trimmed } : {}),
      ...(coords?.lat !== undefined ? { lat: coords.lat } : {}),
      ...(coords?.lng !== undefined ? { lng: coords.lng } : {}),
      ...(code ? { country: code } : {})
    }
  };
}

/**
 * The same decision for a location that arrives whole rather than in parts —
 * from a backup file, a restore, or any other door that did not build it.
 *
 * Such a location is untrusted input: a hand-edited or truncated backup can
 * hold `{}`, a bare coordinate pair or a blank name, all of which the rules
 * now refuse. Rebuilding it here drops the junk and keeps the row, rather
 * than letting one malformed field fail the whole write.
 */
export function locationSlotFrom(
  location: TransactionLocation | null | undefined
): { location?: TransactionLocation } {
  return locationSlot(location?.name, location?.country, location);
}

/**
 * Build the create DTO every import door writes through.
 *
 * This is the chokepoint the CSV escaper already proved out: when each door
 * kept its own field list, a field added to one door reached exactly that
 * door, and the AI wizard shipped six fields while the data hub shipped
 * eleven. The guards live here once; callers only rename their row's fields
 * into this shape.
 *
 * The conditional spreads are load-bearing: an optional key must be absent,
 * not undefined, because Firestore rejects undefined values and an empty
 * tags array would pass the rules while meaning nothing. The location is the
 * one optional that no longer spreads on truthiness: `locationSlot` owns that
 * decision now, because the shape it has to refuse — `{}` and `{ name: '' }` —
 * is exactly what a truthy check waves through. `isRecurring` alone guards on
 * presence rather than truth — false is an answer, and the truthy guard would
 * erase it. `recurringId` takes the
 * truthy guard instead, the same one `addTransaction` uses: an id has no
 * "false" to preserve, and a link the review step declined arrives here as a
 * key holding undefined.
 */
export function toCreateTransactionDTO(row: ImportRowFields, baseCurrency: string): CreateTransactionDTO {
  return {
    type: row.type ?? (row.amount >= 0 ? 'income' : 'expense'),
    amount: Math.abs(row.amount),
    currency: row.currency || baseCurrency,
    categoryId: row.categoryId || FALLBACK_CATEGORY_ID,
    description: row.description || 'Imported transaction',
    date: row.date,
    ...(row.note ? { note: row.note } : {}),
    ...(row.tags?.length ? { tags: row.tags } : {}),
    ...locationSlot(
      row.location?.name,
      row.location?.country ?? row.receiptCountry,
      row.location
    ),
    ...(row.isRecurring !== undefined ? { isRecurring: row.isRecurring } : {}),
    ...(row.recurringId ? { recurringId: row.recurringId } : {}),
    ...(row.period ? { period: row.period } : {})
  };
}
