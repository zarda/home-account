import { CategorizedImportTransaction, FieldConfidence } from '../../models';
import { dayKey } from './transaction-date.utils';

/**
 * The review step's date question, kept pure so the card that asks it and
 * the wizard that gates Continue and Import on the answer cannot disagree.
 */

/**
 * "Today" is the local calendar day — the same reading the picker gives a
 * chosen day (local midnight), so a date picked today is today.
 */
export function datedToday(date: Date, now = new Date()): boolean {
  return dayKey(date) === dayKey(now);
}

/**
 * The grade with one field's entry gone. Absent — not `{}` — once nothing is
 * left: absent is the documented "nobody graded it" shape, the one CSV, JSON
 * and manual rows carry, and `needsVerification` already reads a missing
 * grade as "nobody doubts it". A copy, never the row's own object: the
 * parent still holds that row.
 */
export function withoutFieldConfidence(
  fc: FieldConfidence | undefined,
  field: keyof FieldConfidence
): FieldConfidence | undefined {
  if (!fc) return undefined;
  const rest = Object.fromEntries(
    Object.entries(fc).filter(([key]) => key !== field)
  ) as FieldConfidence;
  return Object.keys(rest).length ? rest : undefined;
}

/**
 * Whether the reviewer still owes an answer about this row's date.
 *
 * Asked only under attention (a receipt reader produced the row; the wizard
 * decides which rows those are, per row rather than per batch because one
 * pick can mix a photo with a CSV), only while the row is going to be
 * imported, and only once. An assumed date reads as today and is still a
 * question; a date read confidently off the receipt is one on any day but
 * today. A low grade that was not assumed never reaches here — the resolver
 * assumes every grade under the bar — so the grade needs no third wording
 * of its own; the verify flag keeps covering it.
 */
export function needsDateAnswer(
  row: CategorizedImportTransaction,
  attention: boolean,
  now = new Date()
): boolean {
  return attention && row.selected && !row.dateReviewed && (!!row.dateAssumed || !datedToday(row.date, now));
}
