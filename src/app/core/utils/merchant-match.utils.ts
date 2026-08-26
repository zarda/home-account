/**
 * Whether two normalized merchant keys describe the same payee.
 *
 * One ladder, in one place. It used to be two: `merchantsMatch` in
 * recurring-pattern.utils (detection) and `merchantNamesMatch` in
 * recurring-conversion.utils (coverage and rule matching), whose own comment
 * already warned that the two sides had to move together.
 *
 * They differed less than that warning suggests. The containment rungs are
 * provably the same predicate — `a.includes(b)` implies `|a| >= |b|`, so
 * "both keys >= 3" and "the shorter key >= 3" are the same condition, and
 * "the longer contains the shorter" is the same as either `includes`. Checked
 * exhaustively over a word list, the two implementations disagreed on exactly
 * one input pair: two empty keys, which the detection copy called a match.
 *
 * So the empty guard here is the conversion copy's, and it is the whole
 * behaviour change of the unification. The detection path never hit that case
 * only because `computeRecurringGroups` filters empty keys before clustering.
 * Leaning on one caller's filter to keep a matcher honest is exactly what
 * breaks when a second caller arrives, which is what merging them creates.
 *
 * This module is a leaf: it imports nothing from either recurring module, so
 * the existing recurring-conversion -> recurring-pattern edge is untouched and
 * no cycle is closed. Note that this does NOT make coverage importable —
 * `CoveragePredicate` stays injected, for the reasons recurring-pattern.utils
 * gives at its own definition.
 */

/** The Dice cut-off two merchant keys must clear to be called the same payee. */
export const DEFAULT_MERCHANT_SIMILARITY = 0.7;

/**
 * Sørensen-Dice coefficient over character bigrams, 0..1, symmetric.
 *
 * Character bigrams rather than word tokens because CJK text has no whitespace
 * to tokenise on, and length-normalised so a long description cannot dominate
 * a short one.
 */
export function bigramSimilarity(a: string, b: string): number {
  if (a === b) {
    return a.length > 0 ? 1 : 0;
  }
  const charsA = Array.from(a);
  const charsB = Array.from(b);
  if (charsA.length < 2 || charsB.length < 2) {
    return 0;
  }

  const countBigrams = (chars: string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (let i = 0; i < chars.length - 1; i += 1) {
      const gram = chars[i] + chars[i + 1];
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    return counts;
  };

  const bigramsA = countBigrams(charsA);
  const bigramsB = countBigrams(charsB);
  let shared = 0;
  for (const [gram, count] of bigramsA) {
    const other = bigramsB.get(gram);
    if (other) {
      shared += Math.min(count, other);
    }
  }

  return (2 * shared) / (charsA.length - 1 + charsB.length - 1);
}

/**
 * Two normalized merchant keys describe the same payee.
 *
 * Three rungs: exact equality, containment, then Dice similarity over
 * character bigrams. Named for keys rather than names because both callers
 * pass `normalizeMerchant` output, not raw descriptions.
 *
 * The containment rung is generous on purpose and has a known cost: "cvs"
 * matches "cvs nails". Blocking by category takes most of the sting out of it
 * in the detection path, and the alternative — dropping the rung — loses
 * "starbucks" against "starbucks shibuya", which is the case it exists for.
 */
export function merchantKeysMatch(
  a: string,
  b: string,
  threshold: number = DEFAULT_MERCHANT_SIMILARITY
): boolean {
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= 3 && longer.includes(shorter)) {
    return true;
  }
  return bigramSimilarity(a, b) >= threshold;
}
