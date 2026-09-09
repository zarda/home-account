import { CategorizedImportTransaction, FieldConfidence, ImagePositionMetadata } from '../../models';
import { dayKey } from './transaction-date.utils';
import { roundMoney } from './transaction-aggregation.utils';
import { normalizeTags } from './tag.utils';

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
 * 0 — inside the same low band every row nothing suggested a category for
 * lands in, under the floor the categorization ladder grades those with,
 * because no categorizer was even asked here: the card offers
 * `other_expense` as the guess it is.
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

/**
 * Which source images a row's evidence actually comes from: every image
 * consolidation merged into it, or its own single image when nothing was
 * merged. The receipt-attachment planner (`receipt-attachment.utils.ts`)
 * reads a row's `imageMetadata` through this rather than its own copy, so
 * the two cannot drift apart; the reading lives here and not there because
 * the planner already imports `MAX_RECEIPTS_PER_TRANSACTION` off
 * `storage.service`, which drags in `@angular/core` and
 * `@angular/fire/storage` — imports this file's own spec has no TestBed to
 * carry, and importing the planner back into this file would hand them to
 * it too.
 */
export function imageSources(meta: ImagePositionMetadata): number[] {
  return meta.mergedFromImages?.length ? meta.mergedFromImages : [meta.imageIndex];
}

/**
 * Whether two rows in one import are the two (or more) halves of a single
 * split, in either direction — a part against the original it was taken off
 * of, an original against its part, or two parts of the same original. Split
 * rows can read as identical twins to `isSameRow` (same day, type,
 * description and, for an even split, the same amount) and that is by
 * design, not a repeat: the reviewer made both on purpose, off one receipt,
 * and the exemption in `findWithinBatchDuplicates` is keyed on this.
 */
export function sameSplit(
  a: CategorizedImportTransaction,
  b: CategorizedImportTransaction
): boolean {
  return (
    a.splitFrom === b.id ||
    b.splitFrom === a.id ||
    (a.splitFrom !== undefined && a.splitFrom === b.splitFrom)
  );
}

/**
 * Take `amount` off `row` into a new row of its own, id `id` — a receipt
 * line the reader merged into one, taken apart before the import. `null`
 * unless `amount` is a positive figure that still leaves something behind on
 * the original, to the cent; `splitImportRow` refuses to produce a kept row
 * at zero or negative, and refuses to hand back two rows that are not really
 * two.
 *
 * The two halves are not even copies, because they do not carry even
 * evidence:
 *  - The amount's grade drops from both — a split is the reviewer overruling
 *    what was read, the same rule a hand-typed correction follows
 *    (`commitAmount`). The date's grade, and every other review-step mark
 *    (`dateAssumed`, `dateReviewed`, `currencyFellBack`, `currencySuggestion`,
 *    `receiptCountry`) and reader-supplied field (`tags`, `location`,
 *    `merchant`, `originalText`, `suggestedCategoryId`, `categoryConfidence`,
 *    `period`), travel to both untouched: the receipt was read once, and
 *    splitting the amount does not reread the date. A part born of a row
 *    whose date question is still open carries `dateAssumed` and shows the
 *    chip too — but the part's id is new, so the wizard's `receiptRowIds`
 *    (stamped once, at extraction) never contains it, and the question does
 *    not gate Continue or Import the way a receipt row's does. It stands on
 *    the same footing as any other assumed date outside a receipt batch.
 *  - `notes`, `duplicateOf`, `recurringId`, `isRecurring` and
 *    `recurringMatch` are deleted off the part rather than carried or
 *    cleared to `undefined` (so `'notes' in part` is false, not true of
 *    nothing): a note about the whole receipt is not a note about a
 *    fraction of it read alone, and a duplicate or recurring verdict was
 *    reached about the original's own amount — a different figure needs its
 *    own. `isDuplicate` resets to `false` and `selected` to `true` for the
 *    same reason: the part is unchecked evidence, not yet a verdict.
 *  - `imageMetadata` is a shallow copy, `date` a new `Date` — the way
 *    `blankImportRow` copies a neighbour's date — and `fieldConfidence` its
 *    own call per half rather than one object handed to both, so an edit to
 *    one half can never reach through a shared object into the other. `tags`,
 *    `location`, `period` and `currencySuggestion` stay exactly as shared as
 *    they already were on `row`, which every editor on the card only ever
 *    replaces, never mutates.
 */
export function splitImportRow(
  row: CategorizedImportTransaction,
  amount: number,
  id: string
): [CategorizedImportTransaction, CategorizedImportTransaction] | null {
  // taken is rounded once, up front, and reused for the part below — the
  // way row.amount reaches this function too, parseAmountInput (via
  // commitAmount) and a CSV cell can both carry three or more decimals.
  // remainder rounds row.amount − taken the same way, once, and the guard
  // judges remainder itself rather than a separately-rounded row.amount:
  // the two roundings can disagree by a cent, and a guard built on the
  // latter can pass a split this function then hands back kept at zero —
  // exactly what it otherwise refuses to produce. `!(remainder > 0)`, not
  // `remainder <= 0`: a NaN row.amount makes remainder NaN too, and
  // `NaN <= 0` is false — only `> 0` negated catches it.
  const taken = roundMoney(amount);
  const remainder = roundMoney(row.amount - taken);
  if (!Number.isFinite(taken) || taken <= 0 || !(remainder > 0)) return null;

  const kept: CategorizedImportTransaction = {
    ...row,
    amount: remainder,
    fieldConfidence: withoutFieldConfidence(row.fieldConfidence, 'amount'),
  };
  const part: CategorizedImportTransaction = {
    ...row,
    id,
    amount: taken,
    splitFrom: row.id,
    fieldConfidence: withoutFieldConfidence(row.fieldConfidence, 'amount'),
    isDuplicate: false,
    selected: true,
    date: new Date(row.date),
  };
  if (row.imageMetadata) part.imageMetadata = { ...row.imageMetadata };
  delete part.notes;
  delete part.duplicateOf;
  delete part.recurringId;
  delete part.isRecurring;
  delete part.recurringMatch;

  return [kept, part];
}

/**
 * Whether a row may take part in a merge, on either side: it has an amount,
 * a description, and no standing duplicate verdict.
 *
 * A blank row is filled first. Merged into, the placeholder's own
 * `other_expense` and the date it copied from a neighbour would win over
 * the source's real ones (the target's identity wins outright below), and
 * the empty description is the only part of that the unfilled gate would
 * catch — a reviewer who then names the row ships a wrong category and
 * date without a sign. Merged away, it has nothing to add.
 *
 * A flagged row is overruled first, by the badge's own control. A merge
 * that cleared the verdict on its own way through would answer a question
 * the reviewer was never shown, and should the re-check behind it fail, a
 * real duplicate is left unflagged and selected — the one edit that would
 * fail open, when an amount edit on a flagged row leaves the flag alone.
 * Selection is not read: a row the reviewer left out can still merge, and
 * comes back selected.
 */
export function mergeableRow(row: CategorizedImportTransaction): boolean {
  return !amountIsUnfilled(row) && !descriptionIsUnfilled(row) && !row.isDuplicate;
}

/**
 * Fold `source` into `target` — a receipt the reader split across two
 * photos, or a wrong split, rejoined before the import. `null` for a row
 * against itself, when the two are not in the same currency — nothing here
 * converts — or when either side fails `mergeableRow`. The judging happens
 * here and nowhere else: the card's own `canMerge`/`mergeTargets` read the
 * same refusals so as never to offer such a pair, but that keeps a menu
 * honest rather than deciding anything, and a `null` reaching the card is
 * a no-op there, not a case of its own.
 *
 * The target's identity wins outright — id, description, date, every
 * review-step mark, category, currency, the recurring link, `splitFrom` —
 * because that is what lets the wizard's own diff see an ordinary amount
 * change on a row it already knows, rather than a row appearing and another
 * disappearing, which would need a rule of its own. `splitFrom` rides the
 * spread rather than being read explicitly: a part merged into stays a
 * part, still recognised by `sameSplit` as the same split as its siblings.
 *
 * The amount is not the two figures added blind: `signed` reads expense as
 * positive and income as negative, so a refund folded into a purchase (or
 * the reverse) nets the two rather than summing unlike signs, and the type
 * follows whichever direction the net actually points — expense on a net of
 * exactly zero, the same tie-break a brand-new row is born with. The
 * amount's grade drops from the result the way a hand correction clears it
 * (`commitAmount`): the figure is now arithmetic the reviewer asked for, not
 * a reading. The date's grade is not this function's business and rides the
 * target's `fieldConfidence` through untouched.
 *
 * `imageMetadata` unions through `imageSources` rather than reading the two
 * `imageIndex`/`mergedFromImages` pairs directly, because a row already
 * folded together by the multi-image consolidator carries its own
 * `mergedFromImages` and a raw `imageIndex` of 0 that would double as
 * "image zero" if read on its own — `imageSources` is the one reading that
 * already knows which of the two to trust. The target's own block survives
 * with the union and `wasMerged` set on it; a lone side is copied rather
 * than aliased, the way `splitImportRow` copies one across a new row.
 *
 * `selected` returns true whatever either side carried: a row the reviewer
 * had left out is back in once another's figure is folded into it. The
 * verdict fields are written clear rather than spread, even though
 * `mergeableRow` keeps a flagged row off both sides and there is no verdict
 * here to overrule: the wizard's reconcile leaves a check's document id on
 * a row it unflags, and the sum is a figure that check never saw. It is the
 * wizard's own diff — the merged row's new amount against the target's old
 * one — that asks the question about it.
 */
export function mergeImportRows(
  target: CategorizedImportTransaction,
  source: CategorizedImportTransaction
): CategorizedImportTransaction | null {
  if (
    target.id === source.id ||
    target.currency !== source.currency ||
    !mergeableRow(target) ||
    !mergeableRow(source)
  ) {
    return null;
  }

  const signed = (row: CategorizedImportTransaction) => (row.type === 'income' ? -row.amount : row.amount);
  const net = roundMoney(signed(target) + signed(source));

  const single = target.imageMetadata ?? source.imageMetadata;
  const imageMetadata = target.imageMetadata && source.imageMetadata
    ? {
        ...target.imageMetadata,
        wasMerged: true,
        mergedFromImages: [...new Set([
          ...imageSources(target.imageMetadata),
          ...imageSources(source.imageMetadata),
        ])].sort((a, b) => a - b),
      }
    : single && { ...single };

  const tags = normalizeTags([...(target.tags ?? []), ...(source.tags ?? [])]);
  const suggestedTags = normalizeTags([...(target.suggestedTags ?? []), ...(source.suggestedTags ?? [])]);

  const merged: CategorizedImportTransaction = {
    ...target,
    type: net < 0 ? 'income' : 'expense',
    amount: Math.abs(net),
    location: target.location ?? source.location,
    receiptCountry: target.receiptCountry ?? source.receiptCountry,
    isDuplicate: false,
    selected: true,
    fieldConfidence: withoutFieldConfidence(target.fieldConfidence, 'amount'),
  };
  // Absent, not undefined, the way splitImportRow leaves what it drops: the
  // spread carries every key the target had, a stale duplicateOf included.
  if (imageMetadata) merged.imageMetadata = imageMetadata;
  else delete merged.imageMetadata;
  if (tags.length) merged.tags = tags;
  else delete merged.tags;
  if (suggestedTags.length) merged.suggestedTags = suggestedTags;
  else delete merged.suggestedTags;
  delete merged.duplicateOf;
  // A blank note is no note, on either side: a total-only receipt lands
  // with `notes: ''` (convertParsedReceipt), which a truthiness test reads
  // as absent and a nullish fallback then keeps over the other side's real
  // one. Absent is the key gone, the way splitImportRow leaves it. Each
  // side is trimmed before the join: commitNotes stores trimmed text but a
  // reader's note is verbatim, and a trailing newline doubles the separator.
  const noteLines = [target.notes, source.notes]
    .filter((n): n is string => !!n?.trim())
    .map(n => n.trim());
  if (noteLines.length) merged.notes = noteLines.join('\n');
  else delete merged.notes;

  return merged;
}
