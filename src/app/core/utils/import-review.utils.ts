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
 * A row the reviewer is about to type, for the items a reader that ran out
 * of room never got to.
 *
 * It takes the day and the currency of the row it follows, because that is
 * what it is missing from: the receipts of one trip are dated together and
 * priced in one currency, and the account's base is the wrong guess for both
 * the moment the batch is foreign. The fallbacks are for the row that
 * follows nothing.
 *
 * Everything a reader would have produced is absent rather than blank: no
 * `imageMetadata` (there is no photo of it, so the planner attaches none),
 * no grade, and none of the review-step marks. An absent grade is the
 * "nobody doubts it" shape `needsVerification` already reads, and a mark
 * here would flag a row nobody could have misread. `categoryConfidence` is
 * 0 for the same reason it is on any row nothing suggested a category for:
 * the card offers `other_expense` as the guess it is.
 *
 * The date is a copy. Sharing the neighbour's `Date` object would leave the
 * picker on one row moving the other, since the picker writes a new object
 * but nothing stops a caller reading the old one.
 */
export function blankImportRow(
  id: string,
  after: CategorizedImportTransaction | undefined,
  fallbackCurrency: string
): CategorizedImportTransaction {
  return {
    id,
    description: '',
    amount: 0,
    currency: after?.currency ?? fallbackCurrency,
    date: after ? new Date(after.date) : new Date(),
    type: 'expense',
    suggestedCategoryId: 'other_expense',
    categoryConfidence: 0,
    isDuplicate: false,
    selected: true,
  };
}

/**
 * Whether the row has no amount an import could ship.
 *
 * Read as "not more than zero" rather than "is zero", so every unusable
 * figure is one case: the 0 a blank row is born with, the 0 a blank or
 * unreadable CSV cell becomes, the NaN a truthy non-number in a model's
 * answer parses to, and a negative figure, which `type` — not the sign —
 * is what states here.
 *
 * The card's placeholder and its trigger's name read this too: a row held
 * back for a gap nothing on it shows is a hunt through the list.
 */
export function amountIsUnfilled(row: CategorizedImportTransaction): boolean {
  return !(row.amount > 0);
}

/**
 * Whether the row has no description an import could ship.
 *
 * A description of nothing but spaces is nothing: the card trims what is
 * typed, but a quoted "   " cell reaches it untrimmed, and the write files
 * an empty one under a name of its own. Trimmed here for the same reason
 * the amount is read the wide way — and the card's placeholder and its
 * trigger's name read this same predicate, or the three disagree over a row
 * whose trigger renders collapsing whitespace with nothing to press on.
 */
export function descriptionIsUnfilled(row: CategorizedImportTransaction): boolean {
  return row.description.trim() === '';
}

/**
 * Whether this row is still short of what an import needs from it.
 *
 * Deselected rows are ignored, the rule `needsDateAnswer` follows: a row
 * that is not going to be imported cannot hold Continue.
 */
export function rowIsUnfilled(row: CategorizedImportTransaction): boolean {
  return row.selected && (amountIsUnfilled(row) || descriptionIsUnfilled(row));
}

/**
 * Two sentences of an accessible name, in the order they are spoken.
 *
 * The reasons a row is flagged are whole sentences with a stop of their own
 * — "." in en, "。" in ja and tc — so the leading one gives its terminator up
 * before the join adds one, or a flagged row is read out "here.. Change".
 * The join itself is a Latin ". " in every locale: it separates two
 * announcements rather than punctuating one sentence, and it is what makes a
 * reader pause between them whatever language it is speaking. Either half
 * may be empty — a row nobody doubts has no reason to lead with — and an
 * empty half is not announced at all.
 *
 * Shared rather than repeated: the review card names four controls this way
 * and the transaction form one, and the first two spellings of the join had
 * already drifted apart.
 */
export function joinSentences(lead: string, next: string): string {
  if (!lead) return next;
  if (!next) return lead;
  return `${lead.replace(/\s*[.。]?\s*$/, '')}. ${next}`;
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
  // A separator with nothing after it is a whole number: the editor commits
  // on blur as well as on Enter, so a reviewer who types the whole part,
  // pauses on the decimal mark and taps the next card sends "12." here — and
  // refusing it now holds the editor open on a figure that was readable.
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const value = Math.abs(Number.parseFloat(normalized));
  return Number.isFinite(value) && value > 0 ? value : null;
}
