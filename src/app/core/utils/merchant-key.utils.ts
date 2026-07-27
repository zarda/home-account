/**
 * A stable key for a merchant description, for comparing one description
 * against another and for remembering what a user decided about a merchant.
 *
 * The `\p{L}\p{N}` classes are what make this Unicode-aware, and that is the
 * whole point. The previous normalizer stripped everything outside `[a-z0-9]`,
 * so every Japanese and Traditional Chinese description collapsed to the empty
 * string — and since duplicate detection compares normalized descriptions for
 * equality, all CJK descriptions compared equal to each other. Any two same-day
 * same-amount transactions with CJK merchant names were reported as an exact
 * duplicate no matter how unrelated the merchants were.
 *
 * Case folding uses `toLowerCase`, which is a no-op for scripts without case
 * and therefore safe to apply unconditionally.
 */
export function normalizeMerchantKey(description: string): string {
  return (description ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Longest key we will store or look up.
 *
 * A key doubles as a Firestore document id, which has a 1500-byte limit; this
 * is well inside it while still being longer than any real merchant name.
 */
export const MAX_MERCHANT_KEY_LENGTH = 300;

/**
 * A key safe to use as a document id, or null when the description normalizes
 * to nothing.
 *
 * An all-punctuation description ("---", "***") normalizes to the empty string,
 * and an empty segment in a Firestore path addresses the *collection* rather
 * than a document in it — so this has to be checked before any write, not after.
 */
export function merchantKeyForStorage(description: string): string | null {
  const key = normalizeMerchantKey(description).slice(0, MAX_MERCHANT_KEY_LENGTH);
  return key.length > 0 ? key : null;
}
