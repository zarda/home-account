import { CategorizedImportTransaction, FieldConfidence } from '../../models';
import { dayKey } from './transaction-date.utils';

/**
 * The review step's corrections, kept pure so the card that offers them and
 * the wizard that gates Continue and Import on the answers cannot disagree.
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

/**
 * A hand-typed amount, or `null` when nothing usable was typed.
 *
 * The reviewer is retyping a figure off a receipt, so the field takes what a
 * receipt prints: a currency symbol, spaces, and either grouping convention.
 * Full-width forms come first, because ja and tc reviewers type with the IME
 * on and `\d` is ASCII: without the fold "１２３" strips to nothing and the
 * correction is dropped without a word, on the locales whose receipts this
 * editor was built for. A comma is a group separator only where a group can
 * be — exactly three digits and then a boundary; otherwise it is the decimal
 * mark, which makes every dot in the same string a separator (that is what
 * tells "1.234,50" apart from "1,234.50"). `Number.parseFloat`, not
 * `Number`: `Number('')` is 0, and an emptied field is a cancel rather than
 * a free amount.
 *
 * What the shape does not read, it refuses. `parseFloat` takes a prefix and
 * stops, so "1.234.567" would come back 1.234 and the lakh-grouped
 * "1,23,456" 1.23456 — plausible figures nobody typed, written onto a money
 * field whose verify flag the same commit drops. A cancel leaves both
 * standing.
 *
 * The sign never comes from the text. `type` owns income against expense and
 * the toggle beside the amount is the only control that changes it, so a
 * minus typed here would flip a row where nothing said it had.
 */
export function parseAmountInput(raw: string): number | null {
  const cleaned = raw
    // The full-width ASCII block, folded whole: the digits, the comma, the
    // dot and the minus all sit in it at a fixed 0xFEE0 offset.
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[^\d.,-]/g, '');
  const ungrouped = cleaned.replace(/,(?=\d{3}(?!\d))/g, '');
  // Either every comma was a group separator or none was. One removed and
  // another left behind is grouped by neither convention — "1,23,456" — and
  // the survivor would otherwise be read as a decimal mark.
  if (ungrouped !== cleaned && ungrouped.includes(',')) return null;
  const normalized = ungrouped.includes(',')
    ? ungrouped.replace(/\./g, '').replace(/,/g, '.')
    : ungrouped;
  if (!/^-?\d*\.?\d+$/.test(normalized)) return null;
  const value = Math.abs(Number.parseFloat(normalized));
  return Number.isFinite(value) && value > 0 ? value : null;
}
