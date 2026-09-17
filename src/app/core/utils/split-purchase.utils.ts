import { roundToMinorUnit, SplitPart } from '../../models';

/** A split needs at least this many parts; the form's own minimum. */
export const SPLIT_MIN_PARTS = 1;

/**
 * What stays on the purchase's own category once every part is taken off,
 * rounded to the currency's minor unit like each part itself — or `null`
 * when the split cannot stand: too few parts, a part with no category, a
 * part that is not a usable positive figure, a part that rounds to nothing
 * in this currency, or parts that reach or exceed the total and leave no
 * remainder. The only validity rule for a part lives here, so every
 * consumer — both service seams and the form's own submit gate — refuses
 * the same categoryless part rather than each checking it separately.
 */
export function splitRemainder(total: number, parts: SplitPart[], currencyCode: string): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  if (parts.length < SPLIT_MIN_PARTS) return null;

  let taken = 0;
  for (const part of parts) {
    if (typeof part.categoryId !== 'string' || part.categoryId.trim() === '') return null;
    const rounded = roundToMinorUnit(part.amount, currencyCode);
    if (!Number.isFinite(rounded) || rounded <= 0) return null;
    taken += rounded;
  }

  const remainder = roundToMinorUnit(total - taken, currencyCode);
  return remainder > 0 ? remainder : null;
}
